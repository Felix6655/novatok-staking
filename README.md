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
# Build the program
anchor build

# Generate IDL and TypeScript types
anchor build --idl
```

## Testing (Devnet)

```bash
# Configure for devnet
solana config set --url devnet

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
