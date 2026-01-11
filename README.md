# novatok-staking

Single-token, time-locked staking program for the NOVA token (V1, devnet).

## Overview

This is a Solana staking program built with the Anchor framework. It allows users to stake NOVA tokens and earn rewards based on their chosen tier.

## Staking Tiers

| Tier  | Lock Period | APY  |
|-------|-------------|------|
| Flex  | No lock     | 4%   |
| Core  | 90 days     | 10%  |
| Prime | 180 days    | 14%  |

## Features

- **Linear Reward Accrual**: Rewards accumulate linearly based on staking duration
- **Claim Without Unstaking**: Users can claim rewards at any time without unstaking
- **Lock Period Enforcement**: Core and Prime tiers enforce lock periods before unstaking
- **Treasury-Funded Rewards**: All rewards are paid from a treasury vault
- **Emission Cap**: Total rewards are capped to prevent unlimited emissions
- **Admin Controls**: Pool admin can pause staking and adjust APY rates
- **Safe Math**: All calculations use overflow-protected arithmetic

## Scripts

### Stake Status Script

Check staking status for any user on devnet:

```bash
# Check your own stake status
yarn stake-status --mint <NOVA_MINT_PUBKEY>

# Check another user's stake status
yarn stake-status --mint <NOVA_MINT_PUBKEY> --user <USER_PUBKEY>

# Using ts-node directly
npx ts-node scripts/stake-status.ts --mint <MINT> --user <USER>
```

**Output includes:**
- Staked amount
- Staking tier (Flex/Core/Prime)
- Stake start time
- Lock end time (if applicable)
- Estimated accrued rewards
- Last claim time

**Wallet Configuration:**
- Set `SOLANA_WALLET` environment variable to path of keypair JSON
- Or uses default: `~/.config/solana/id.json`

⚠️ **No private keys are stored in the repo** - the script reads from your local keypair file.

## Program Structure

```
programs/nova_staking/src/
├── lib.rs                    # Main program entry point
├── constants.rs              # Program constants
├── error.rs                  # Custom error types
├── state/
│   ├── mod.rs
│   ├── stake_pool.rs         # Pool configuration state
│   └── user_stake.rs         # User staking state
└── instructions/
    ├── mod.rs
    ├── initialize.rs         # Pool initialization
    ├── stake.rs              # Stake tokens
    ├── unstake.rs            # Unstake tokens
    ├── claim_rewards.rs      # Claim rewards
    ├── admin.rs              # Admin controls
    └── fund_treasury.rs      # Fund reward treasury
```

## Test Suite

Comprehensive Anchor test suite located in `/tests/`:

```
tests/
├── nova-staking.ts     # Main test suite
└── utils.ts            # Test utilities
```

### Test Coverage

1. **Initialize Pool** - Admin-only pool creation, verify stored admin pubkey
2. **PDA Creation** - Vault and treasury PDA token accounts (SPL Token)
3. **Staking All Tiers** - Flex, Core (90-day), Prime (180-day)
4. **Vault Balance** - Verify balance increases on stake
5. **User Stake State** - Verify amount, tier, start_ts, last_claim_ts
6. **Claim Rewards** - Rewards > 0 after time, updates timestamps, double-claim yields ~0
7. **Lock Enforcement** - Core/Prime cannot unstake before lock expires, Flex can unstake immediately
8. **Unstake After Lock** - Vault decreases, user receives principal
9. **Emission Cap** - Low cap blocks claims when exceeded
10. **Pause/Unpause** - Paused pool blocks stake, unpause restores behavior

### Running Tests

```bash
# Install dependencies
yarn install

# Start local validator
solana-test-validator

# Build and run tests
anchor build
anchor test --skip-local-validator

# Or run all in one command (starts validator automatically)
anchor test
```

### Test Constraints

- **Integer Math Only**: No floating point operations
- **Localnet**: Tests run against local Solana validator
- **Deterministic**: All tests use deterministic values and seeds

## Instructions

### initialize
Creates a new staking pool with specified parameters.

**Parameters:**
- `emission_cap`: Maximum total rewards distributable
- `flex_apy`: APY for Flex tier (basis points, e.g., 400 = 4%)
- `core_apy`: APY for Core tier (basis points)
- `prime_apy`: APY for Prime tier (basis points)

### stake
Stakes NOVA tokens in the specified tier.

**Parameters:**
- `amount`: Amount of tokens to stake
- `tier`: Staking tier (0=Flex, 1=Core, 2=Prime)

### unstake
Unstakes tokens from the pool. Lock periods are enforced.

**Parameters:**
- `amount`: Amount of tokens to unstake

### claim_rewards
Claims accumulated rewards without unstaking.

### set_paused
Admin function to pause/unpause staking.

**Parameters:**
- `paused`: Boolean pause state

### adjust_apy
Admin function to adjust APY rates.

**Parameters:**
- `flex_apy`: New Flex tier APY
- `core_apy`: New Core tier APY
- `prime_apy`: New Prime tier APY

### update_emission_cap
Admin function to update the emission cap.

**Parameters:**
- `new_cap`: New emission cap value

### fund_treasury
Deposits reward tokens into the treasury.

**Parameters:**
- `amount`: Amount of tokens to fund

## Building

```bash
# Install Rust and Solana prerequisites
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
sh -c "$(curl -sSfL https://release.solana.com/v1.18.15/install)"
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install latest && avm use latest

# Build the program
anchor build

# Generate IDL and TypeScript types
anchor build --idl
```

## Deployment (Devnet Only)

```bash
# Configure for devnet
solana config set --url devnet

# Generate keypair
solana-keygen new

# Airdrop SOL for deployment
solana airdrop 5

# Deploy to devnet
anchor deploy --provider.cluster devnet
```

## Security Considerations

1. **Overflow Protection**: All arithmetic operations use checked math
2. **PDA Validation**: All PDAs are properly derived and validated
3. **Authority Checks**: Admin functions verify the caller is the pool authority
4. **Lock Period Enforcement**: Core/Prime tiers cannot unstake early
5. **Emission Cap**: Prevents unlimited reward distribution

## Devnet Only

⚠️ **This program is configured for Solana devnet only.**

Do NOT deploy to mainnet without:
- Comprehensive audit
- Additional security measures
- Thorough testing
- Multi-sig admin controls

## Constants

- `CORE_LOCK_PERIOD`: 90 days (7,776,000 seconds)
- `PRIME_LOCK_PERIOD`: 180 days (15,552,000 seconds)
- `MAX_APY`: 5000 basis points (50%)
- `BASIS_POINTS_DENOMINATOR`: 10,000
- `SECONDS_PER_YEAR`: 31,536,000

## Error Codes

| Code | Error | Description |
|------|-------|-------------|
| 6000 | StakingPaused | Staking is currently paused |
| 6001 | InvalidTier | Invalid staking tier specified |
| 6002 | ZeroAmount | Amount must be greater than zero |
| 6003 | InsufficientStakedBalance | Not enough staked tokens |
| 6004 | LockPeriodNotEnded | Lock period has not ended |
| 6005 | NoRewardsAvailable | No rewards to claim |
| 6006 | InsufficientTreasuryFunds | Treasury is empty |
| 6007 | EmissionCapExceeded | Would exceed emission cap |
| 6008 | ApyTooHigh | APY exceeds maximum |
| 6009 | InvalidEmissionCap | Invalid emission cap value |
| 6010 | MathOverflow | Arithmetic overflow |
| 6011 | StakeAlreadyExists | User already has stake |
| 6012 | NoActiveStake | No active stake found |
| 6013 | MintMismatch | Token mint mismatch |
| 6014 | CannotChangeTier | Cannot change tier |
| 6015 | Unauthorized | Caller not authorized |

## License

MIT
