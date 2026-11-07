# Contracts

See the [project README](../README.md) for what each contract does.

```bash
forge install            # first time: fetch forge-std, v4-core, v4-periphery, openzeppelin
forge test --no-match-contract SepoliaFork
SEPOLIA_RPC_URL=<rpc> forge test --match-contract SepoliaFork -vv
```
