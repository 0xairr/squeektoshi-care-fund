// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary, toBeforeSwapDelta} from "v4-core/src/types/BeforeSwapDelta.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {CareVault} from "./CareVault.sol";
import {BuybackBurner} from "./BuybackBurner.sol";

/// @title CareHook
/// @notice A Uniswap v4 hook that takes 5% of the ETH side of every buy and sell on the ETH/CARE
///         pool, and never switches off. Where the 5% goes depends only on the vault:
///
///           - while the CareVault holds less than one month of care, the fee goes to the vault;
///           - once it holds a full month, the fee goes to the BuybackBurner, which buys CARE on
///             this pool and sends it to a burn address.
///
///         The hook only sends the vault what it is still missing, so the vault fills to its cap and
///         never past it. A swap whose fee crosses the line is split between the two.
///
/// The fee is a constant, there is no owner and no setter. `splitFee()` is public, so anyone can see
/// where the next swap's fee will go.
contract CareHook is IHooks {
    // ---------------------------------------------------------------- constants

    /// @notice The fee: 5% of the ETH side of every swap.
    uint24 public constant FEE_BPS = 500;

    uint24 internal constant BPS = 10_000;

    /// @notice Native ETH is always currency0 on a v4 pool.
    Currency internal constant ETH = Currency.wrap(address(0));

    // ---------------------------------------------------------------- immutables

    IPoolManager public immutable poolManager;

    /// @notice The vault that pays for the hamster.
    CareVault public immutable vault;

    /// @notice The care token. Only the ETH/token pool is charged.
    address public immutable careToken;

    /// @dev Together with the currencies these pin the hook to one pool key: a pool that merely
    ///      names this hook is not charged.
    uint24 public immutable poolFee;
    int24 public immutable tickSpacing;

    /// @notice Where the fee goes once the vault is full. Deployed first; it is bound to this hook
    ///         once, by `BuybackBurner.bindHook`, which checks that this hook names it.
    BuybackBurner public immutable burner;

    // ---------------------------------------------------------------- events

    /// @notice One per charged swap: how much was taken and where it went.
    event FeeTaken(bool indexed buy, uint256 fee, uint256 toCare, uint256 toBurn);

    // ---------------------------------------------------------------- transient state

    /// @dev Transient slot for the fee claimed in `beforeSwap`, collected in the same swap's
    ///      `afterSwap`. Transient storage is cleared at the end of the transaction.
    uint256 internal constant CLAIMED_FEE_SLOT = 0xca11fee;

    function _setClaimedFee(uint256 amount) internal {
        assembly ("memory-safe") {
            tstore(CLAIMED_FEE_SLOT, amount)
        }
    }

    function _getClaimedFee() internal view returns (uint256 amount) {
        assembly ("memory-safe") {
            amount := tload(CLAIMED_FEE_SLOT)
        }
    }

    // ---------------------------------------------------------------- errors

    error NotPoolManager();
    error HookNotImplemented();

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        _;
    }

    /// @param poolManager_ The v4 PoolManager this hook is registered with.
    /// @param vault_ The CareVault that receives the fee until it is full.
    /// @param careToken_ The token of the ETH/token pool this hook serves.
    /// @param poolFee_ The pool's own LP fee, part of the key this hook charges on.
    /// @param tickSpacing_ The pool's tick spacing, part of the same key.
    /// @param burner_ The BuybackBurner for the same token and pool.
    constructor(
        IPoolManager poolManager_,
        CareVault vault_,
        address careToken_,
        uint24 poolFee_,
        int24 tickSpacing_,
        BuybackBurner burner_
    ) {
        require(address(poolManager_).code.length > 0, "no pool manager");
        // Every swap asks the vault for its shortfall, so a vault address with no code would make
        // every swap on the pool revert. Fail the deployment instead.
        require(address(vault_).code.length > 0, "no vault");
        require(careToken_.code.length > 0, "no token");

        poolManager = poolManager_;
        vault = vault_;
        careToken = careToken_;
        poolFee = poolFee_;
        tickSpacing = tickSpacing_;

        require(address(burner_).code.length > 0, "no burner");
        require(
            burner_.token() == careToken_ && burner_.poolFee() == poolFee_ && burner_.tickSpacing() == tickSpacing_
                && address(burner_.poolManager()) == address(poolManager_),
            "burner is for another pool"
        );
        burner = burner_;

        // Reverts unless this contract sits at an address whose flag bits match the callbacks below.
        Hooks.validateHookPermissions(IHooks(address(this)), getHookPermissions());
    }

    // ---------------------------------------------------------------- views

    /// @notice How a fee of `fee` wei is split right now: the vault gets what it is missing (up to
    ///         the whole fee), the burner gets the rest.
    function splitFee(uint256 fee) public view returns (uint256 care, uint256 buyback) {
        care = vault.careShortfallEth();
        if (care > fee) care = fee;
        buyback = fee - care;
    }

    /// @notice The pool this hook serves.
    function poolKey() external view returns (PoolKey memory) {
        return PoolKey({
            currency0: ETH,
            currency1: Currency.wrap(careToken),
            fee: poolFee,
            tickSpacing: tickSpacing,
            hooks: IHooks(address(this))
        });
    }

    /// @notice The callbacks this hook uses. The address is mined to match (see `script/Deploy.s.sol`).
    function getHookPermissions() public pure returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: true,
            afterSwapReturnDelta: true,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    // ---------------------------------------------------------------- internals

    function _isOurPool(PoolKey calldata key) internal view returns (bool) {
        return Currency.unwrap(key.currency0) == address(0) && Currency.unwrap(key.currency1) == careToken
            && key.fee == poolFee && key.tickSpacing == tickSpacing;
    }

    /// @dev Moves the fee straight out of the PoolManager to the vault and the burner, so the hook
    ///      never holds money.
    function _routeFee(uint256 fee, bool buy) internal {
        (uint256 care, uint256 buyback) = splitFee(fee);
        if (care > 0) poolManager.take(ETH, address(vault), care);
        if (buyback > 0) poolManager.take(ETH, address(burner), buyback);
        emit FeeTaken(buy, fee, care, buyback);
    }

    // ---------------------------------------------------------------- swap callbacks

    function beforeSwap(address sender, PoolKey calldata key, IPoolManager.SwapParams calldata params, bytes calldata)
        external
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        // The buyback is never charged: the burner only ever spends its own balance on this pool.
        if (!_isOurPool(key) || sender == address(burner)) {
            return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }

        // ETH is the specified currency for an exact-in buy and an exact-out sell. The other two
        // shapes are charged in afterSwap, where the ETH amount is known.
        bool exactIn = params.amountSpecified < 0;
        if (params.zeroForOne != exactIn) {
            return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
        }

        int256 specified = params.amountSpecified;
        uint256 ethAmount = specified < 0 ? uint256(-specified) : uint256(specified);
        uint256 fee = (ethAmount * FEE_BPS) / BPS;
        if (fee == 0) return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);

        // Claim the fee from the ETH side; the pool swaps the rest. Collected in afterSwap.
        _setClaimedFee(fee);
        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(int128(uint128(fee)), 0), 0);
    }

    function afterSwap(
        address sender,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata
    ) external onlyPoolManager returns (bytes4, int128) {
        uint256 claimed = _getClaimedFee();
        if (claimed > 0) {
            _setClaimedFee(0);
            _routeFee(claimed, params.zeroForOne);
            return (IHooks.afterSwap.selector, 0);
        }

        if (!_isOurPool(key) || sender == address(burner)) {
            return (IHooks.afterSwap.selector, 0);
        }

        bool exactIn = params.amountSpecified < 0;
        if (params.zeroForOne == exactIn) {
            // Charged in beforeSwap (or the fee rounded to zero there).
            return (IHooks.afterSwap.selector, 0);
        }

        // ETH is the unspecified currency: on a buy it is what the swapper paid (negative), on a
        // sell it is what the swapper receives (positive).
        int128 ethDelta = delta.amount0();
        uint256 ethAmount;
        if (params.zeroForOne) {
            if (ethDelta >= 0) return (IHooks.afterSwap.selector, 0);
            ethAmount = uint256(uint128(-ethDelta));
        } else {
            if (ethDelta <= 0) return (IHooks.afterSwap.selector, 0);
            ethAmount = uint256(uint128(ethDelta));
        }

        uint256 fee = (ethAmount * FEE_BPS) / BPS;
        if (fee == 0) return (IHooks.afterSwap.selector, 0);

        _routeFee(fee, params.zeroForOne);
        return (IHooks.afterSwap.selector, int128(uint128(fee)));
    }

    // ---------------------------------------------------------------- unused callbacks

    function beforeInitialize(address, PoolKey calldata, uint160) external view onlyPoolManager returns (bytes4) {
        revert HookNotImplemented();
    }

    function afterInitialize(address, PoolKey calldata, uint160, int24) external view onlyPoolManager returns (bytes4) {
        revert HookNotImplemented();
    }

    function beforeAddLiquidity(address, PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata, bytes calldata)
        external
        view
        onlyPoolManager
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external view onlyPoolManager returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function beforeRemoveLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        bytes calldata
    ) external view onlyPoolManager returns (bytes4) {
        revert HookNotImplemented();
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external view onlyPoolManager returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        view
        onlyPoolManager
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        view
        onlyPoolManager
        returns (bytes4)
    {
        revert HookNotImplemented();
    }
}
