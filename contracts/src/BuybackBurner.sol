// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {FullMath} from "v4-core/src/libraries/FullMath.sol";
import {IERC20Minimal} from "v4-core/src/interfaces/external/IERC20Minimal.sol";

/// @dev What `bindHook` checks on the hook.
interface IBurnerHook {
    function burner() external view returns (address);
    function careToken() external view returns (address);
    function poolFee() external view returns (uint24);
    function tickSpacing() external view returns (int24);
    function poolManager() external view returns (IPoolManager);
}

/// @title BuybackBurner
/// @notice Once the CareVault holds a full month of care, the swap fee lands here as ETH. Anyone
///         can call `burn()`, which spends that ETH on the care token on the same pool and sends
///         the tokens to a dead address, so they can never be sold again.
///
/// There is no owner, no setter and no way to withdraw: the ETH held here can only leave through the
/// pool as a buy, and the tokens bought can only go to the burn address.
///
/// Guards on every burn:
///   - nothing is spent below `minEthToBurn`, so gas is never wasted on dust;
///   - the caller sets the minimum tokens out, and that bound may sit at most `maxSlippageBps`
///     below the pool's current price, so a burn cannot be sent through at any price;
///   - the swap is exact-input ETH -> token.
///
/// The price bound is read from the pool in the same transaction, so on its own it does not stop
/// someone moving the price first. What makes that unprofitable is the hook's 5% fee: moving the
/// price and moving it back costs about 10% of the size of the move, far more than a burn of this
/// size could give back.
contract BuybackBurner {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    /// @notice Nothing can move tokens from here: no key, no contract, no code.
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    uint256 internal constant BPS = 10_000;

    /// @dev ETH is always currency0 on a v4 pool.
    Currency internal constant ETH = Currency.wrap(address(0));

    // ---------------------------------------------------------------- immutables

    IPoolManager public immutable poolManager;

    /// @notice The CareHook this burner buys through. Bound once by the deployer, then fixed for good.
    /// @dev Not an immutable because the two contracts cannot be created in one transaction on current
    ///      Sepolia: storing both codes at once costs more than the per-transaction gas cap. The burner
    ///      is deployed first, the hook is deployed naming it, then `bindHook` links them.
    address public hook;

    /// @notice Who may call `bindHook`, once. Has no other power.
    address public immutable deployer;

    /// @notice The care token: bought on the market, then destroyed.
    address public immutable token;

    uint24 public immutable poolFee;
    int24 public immutable tickSpacing;

    /// @notice ETH has to pile up to at least this before a burn is worth the gas.
    uint256 public immutable minEthToBurn;

    /// @notice How far below the pool's price a burn is allowed to fill, at worst. A ceiling, not a
    ///         target: the caller's own bound can always be tighter.
    uint256 public immutable maxSlippageBps;

    // ---------------------------------------------------------------- events & errors

    /// @param ethIn ETH spent buying the token.
    /// @param tokensBurned Tokens bought and sent to the burn address.
    /// @param caller Whoever triggered the burn. Anyone can.
    event Burned(uint256 ethIn, uint256 tokensBurned, address indexed caller);
    event HookBound(address indexed hook);

    error NotPoolManager();
    error NothingToBurn();
    error BelowMinimum(uint256 ethIn, uint256 minimum);
    error SlippageBoundTooLoose(uint256 given, uint256 floor);
    error SlippageExceeded(uint256 tokensOut, uint256 minimum);
    error UnexpectedSwapDelta(int128 amount0, int128 amount1);
    error TransferFailed();
    error NotDeployer();
    error AlreadyBound();
    error NotBound();
    error WrongHook();

    constructor(
        IPoolManager poolManager_,
        address token_,
        uint24 poolFee_,
        int24 tickSpacing_,
        uint256 minEthToBurn_,
        uint256 maxSlippageBps_
    ) {
        require(address(poolManager_).code.length > 0, "no pool manager");
        require(token_.code.length > 0, "no token");
        require(minEthToBurn_ > 0, "burn floor must be set");
        require(maxSlippageBps_ < BPS, "slippage ceiling must be below 100%");

        poolManager = poolManager_;
        deployer = msg.sender;
        token = token_;
        poolFee = poolFee_;
        tickSpacing = tickSpacing_;
        minEthToBurn = minEthToBurn_;
        maxSlippageBps = maxSlippageBps_;
    }

    /// @notice The fee arrives here as plain ETH, straight from the pool. Nothing else to do.
    receive() external payable {}

    /// @notice Link this burner to its hook, once. The hook must already name this burner and serve
    ///         the same pool, so the deployer cannot point it anywhere else.
    function bindHook(address hook_) external {
        if (msg.sender != deployer) revert NotDeployer();
        if (hook != address(0)) revert AlreadyBound();
        IBurnerHook h = IBurnerHook(hook_);
        if (
            hook_.code.length == 0 || h.burner() != address(this) || h.careToken() != token || h.poolFee() != poolFee
                || h.tickSpacing() != tickSpacing || address(h.poolManager()) != address(poolManager)
        ) revert WrongHook();
        hook = hook_;
        emit HookBound(hook_);
    }

    // ---------------------------------------------------------------- views

    /// @notice ETH waiting to be spent on a buyback.
    function pendingEth() external view returns (uint256) {
        return address(this).balance;
    }

    /// @notice The pool this burner buys from. Same key the hook charges on.
    function poolKey() public view returns (PoolKey memory) {
        return PoolKey({
            currency0: ETH, currency1: Currency.wrap(token), fee: poolFee, tickSpacing: tickSpacing, hooks: IHooks(hook)
        });
    }

    /// @notice What `ethIn` would buy at the pool's current price, ignoring price impact. Used as the
    ///         reference for the slippage ceiling, and handy for anyone calling `burn()`.
    function spotTokensForEth(uint256 ethIn) public view returns (uint256) {
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolKey().toId());
        if (sqrtPriceX96 == 0) return 0;
        // amount1 = amount0 * sqrtPriceX96^2 / 2^192, done in two mulDiv steps so extreme prices
        // cannot overflow the 256-bit square.
        uint256 out = FullMath.mulDiv(ethIn, uint256(sqrtPriceX96), 1 << 96);
        return FullMath.mulDiv(out, uint256(sqrtPriceX96), 1 << 96);
    }

    /// @notice The lowest `minTokensOut` a burn of `ethIn` is allowed to declare.
    function slippageFloor(uint256 ethIn) public view returns (uint256) {
        return (spotTokensForEth(ethIn) * (BPS - maxSlippageBps)) / BPS;
    }

    // ---------------------------------------------------------------- the burn

    /// @notice Buy the token with the ETH held here and destroy it. Callable by anyone, at any time.
    /// @param ethIn How much of the held ETH to spend. Zero (or more than the balance) means all of it.
    /// @param minTokensOut Minimum tokens the buy must produce, or the whole call reverts.
    /// @return tokensBurned Tokens bought and sent to the burn address.
    function burn(uint256 ethIn, uint256 minTokensOut) external returns (uint256 tokensBurned) {
        if (hook == address(0)) revert NotBound();
        uint256 balance = address(this).balance;
        if (ethIn == 0 || ethIn > balance) ethIn = balance;
        if (ethIn == 0) revert NothingToBurn();
        if (ethIn < minEthToBurn) revert BelowMinimum(ethIn, minEthToBurn);

        uint256 floor = slippageFloor(ethIn);
        if (minTokensOut < floor) revert SlippageBoundTooLoose(minTokensOut, floor);

        tokensBurned = abi.decode(poolManager.unlock(abi.encode(ethIn, minTokensOut)), (uint256));
        emit Burned(ethIn, tokensBurned, msg.sender);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (uint256 ethIn, uint256 minTokensOut) = abi.decode(data, (uint256, uint256));

        // Sell the ETH for the token: ETH is currency0, so the swap is zeroForOne, exact input.
        BalanceDelta delta = poolManager.swap(
            poolKey(),
            IPoolManager.SwapParams({
                zeroForOne: true, amountSpecified: -int256(ethIn), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            ""
        );

        int128 amount0 = delta.amount0();
        int128 amount1 = delta.amount1();
        // The delta is written from our side: what we paid is negative, what we bought is positive.
        // The input is exact, so the ETH owed must be exactly the ETH we are about to settle -
        // anything else would leave a credit inside the PoolManager that nothing here can withdraw.
        if (amount0 != -int256(ethIn) || amount1 <= 0) revert UnexpectedSwapDelta(amount0, amount1);

        uint256 tokensOut = uint256(uint128(amount1));
        if (tokensOut < minTokensOut) revert SlippageExceeded(tokensOut, minTokensOut);

        // Pay what we owe, collect what we bought, then destroy it.
        poolManager.sync(ETH);
        poolManager.settle{value: ethIn}();
        poolManager.take(Currency.wrap(token), address(this), tokensOut);

        if (!IERC20Minimal(token).transfer(BURN_ADDRESS, tokensOut)) revert TransferFailed();

        return abi.encode(tokensOut);
    }
}
