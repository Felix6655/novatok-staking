# Security Model - Nova Staking Program

## Overview

This document describes the security assumptions, threat model, and mitigations implemented in the Nova Staking program.

**Status**: Devnet Only - NOT AUDITED

## Security Assumptions

### Trusted Components

1. **Solana Runtime**: We assume the Solana runtime correctly executes BPF programs and enforces account ownership.

2. **SPL Token Program**: We assume the SPL Token program correctly handles token transfers and account validation.

3. **Anchor Framework**: We assume Anchor correctly generates discriminators, PDA derivations, and account validations.

4. **Clock Sysvar**: We assume `Clock::get()` returns accurate timestamps (within validator tolerance).

### Trust Boundaries

| Entity | Trust Level | Notes |
|--------|-------------|-------|
| Pool Admin | Semi-trusted | Can pause, adjust APY, modify emission cap |
| Users | Untrusted | Can only affect their own stake |
| Treasury Funders | Untrusted | Anyone can deposit (no admin restriction) |
| Validators | Trusted | Clock accuracy depends on validator consensus |

## Threat Model

### Threats Mitigated

#### 1. Token Theft via Wrong Mint
**Threat**: Attacker tries to stake/unstake with wrong token.
**Mitigation**: 
- `staking_mint` is locked at pool initialization
- Every instruction validates `mint == stake_pool.staking_mint`
- Error: `MintMismatch` (6050)

#### 2. Vault/Treasury Swap Attack
**Threat**: Attacker provides fake vault to steal funds.
**Mitigation**:
- Vault and treasury are PDAs derived from stake_pool
- Seeds: `[POOL_VAULT_SEED, stake_pool.key()]`
- Owner must be stake_pool PDA
- Addresses stored in pool state at init (immutable)
- Errors: `VaultMismatch` (6051), `TreasuryMismatch` (6052)

#### 3. Unauthorized Admin Actions
**Threat**: Non-admin tries to pause/adjust APY.
**Mitigation**:
- `AdminControl` requires signer == `stake_pool.authority`
- Anchor's `has_one` constraint enforces this
- Error: `Unauthorized` (6040)

#### 4. Cross-Pool Attacks
**Threat**: User stake from Pool A used in Pool B.
**Mitigation**:
- UserStake PDA includes pool pubkey in seeds
- Constraint: `user_stake.stake_pool == stake_pool.key()`
- Error: `StakePoolMismatch` (6054)

#### 5. Arithmetic Overflow/Underflow
**Threat**: Manipulate calculations via overflow.
**Mitigation**:
- All arithmetic uses `checked_*` operations
- Intermediate calculations use u128
- Safe i64↔u64 conversions
- Errors: `MathOverflow` (6030), `MathUnderflow` (6031)

#### 6. Unlimited Reward Emission
**Threat**: Drain treasury via unlimited claims.
**Mitigation**:
- `emission_cap` limits total distributable rewards
- Checked on every claim: `total_distributed + claim <= emission_cap`
- Error: `EmissionCapExceeded` (6013)

#### 7. Lock Period Bypass
**Threat**: Unstake Core/Prime early.
**Mitigation**:
- `is_lock_ended()` checks `current_time >= stake_start + lock_period`
- Lock periods: Core=90 days, Prime=180 days
- Uses `saturating_add` for overflow safety
- Error: `LockPeriodNotEnded` (6020)

#### 8. Stake Owner Impersonation
**Threat**: Unstake/claim another user's stake.
**Mitigation**:
- User must be signer
- Constraint: `user_stake.owner == user.key()`
- Error: `InvalidStakeOwner` (6041)

### Threats NOT Mitigated (Out of Scope)

1. **Admin Key Compromise**: If admin key is stolen, attacker can pause/adjust APY. Consider multi-sig for production.

2. **Front-Running**: Validators can reorder transactions. MEV is a protocol-level concern.

3. **Oracle Manipulation**: No external oracles used. APY is set by admin.

4. **Smart Contract Upgrade**: Program is not upgradeable in this version.

5. **Treasury Drain via Admin**: Admin cannot drain treasury directly, but can set emission_cap to zero (future rewards blocked).

## Error Code Reference

### Input Validation (6000-6009)
| Code | Name | Description |
|------|------|-------------|
| 6000 | StakingPaused | Pool is paused |
| 6001 | InvalidTier | Tier must be 0, 1, or 2 |
| 6002 | ZeroAmount | Amount must be > 0 |
| 6003 | ApyTooHigh | APY > 50% |
| 6004 | InvalidEmissionCap | Cap < distributed |
| 6005 | ZeroEmissionCap | Cap must be > 0 |

### State Errors (6010-6019)
| Code | Name | Description |
|------|------|-------------|
| 6010 | InsufficientStakedBalance | Not enough staked |
| 6011 | NoRewardsAvailable | Nothing to claim |
| 6012 | InsufficientTreasuryFunds | Treasury empty |
| 6013 | EmissionCapExceeded | Would exceed cap |
| 6014 | NoActiveStake | Stake not found |
| 6015 | CannotChangeTier | Active stake exists |

### Time Errors (6020-6029)
| Code | Name | Description |
|------|------|-------------|
| 6020 | LockPeriodNotEnded | Still locked |
| 6021 | InvalidTimestamp | Bad clock value |
| 6022 | NegativeTimeDuration | Time went backwards |

### Math Errors (6030-6039)
| Code | Name | Description |
|------|------|-------------|
| 6030 | MathOverflow | Addition overflow |
| 6031 | MathUnderflow | Subtraction underflow |
| 6032 | DivisionByZero | Divide by zero |
| 6033 | ConversionOverflow | u128→u64 failed |

### Auth Errors (6040-6049)
| Code | Name | Description |
|------|------|-------------|
| 6040 | Unauthorized | Not admin |
| 6041 | InvalidStakeOwner | Wrong owner |
| 6042 | UnauthorizedStakeAccess | Can't access stake |

### Account Errors (6050-6059)
| Code | Name | Description |
|------|------|-------------|
| 6050 | MintMismatch | Wrong token |
| 6051 | VaultMismatch | Wrong vault |
| 6052 | TreasuryMismatch | Wrong treasury |
| 6053 | PoolMismatch | Wrong pool |
| 6054 | StakePoolMismatch | Stake from wrong pool |
| 6055 | InvalidVaultOwner | Vault not owned by pool |
| 6056 | InvalidTreasuryOwner | Treasury not owned by pool |
| 6057 | InvalidPDA | Bad PDA derivation |
| 6058 | InvalidTokenAccountMint | Token account wrong mint |
| 6059 | BumpMismatch | PDA bump mismatch |

## Security Invariants

These properties should ALWAYS hold:

1. **Mint Immutability**: `stake_pool.staking_mint` never changes after init
2. **Vault Ownership**: `staking_vault.owner == stake_pool.key()`
3. **Treasury Ownership**: `treasury_vault.owner == stake_pool.key()`
4. **Emission Bound**: `total_distributed <= emission_cap`
5. **Balance Consistency**: `staking_vault.amount >= sum(all user staked_amounts)`
6. **Owner Match**: Only `user_stake.owner` can unstake/claim that stake
7. **Admin Match**: Only `stake_pool.authority` can call admin functions
8. **Lock Enforcement**: Core/Prime cannot unstake before lock expires

## Recommendations for Production

1. **Multi-Sig Admin**: Use Squads or similar for admin key
2. **Timelock**: Add delay for admin operations
3. **Rate Limiting**: Consider per-block claim limits
4. **Audit**: Get professional security audit before mainnet
5. **Bug Bounty**: Establish responsible disclosure program
6. **Monitoring**: Set up alerts for unusual activity
7. **Emergency Pause**: Current pause only blocks new stakes; consider full pause

## Contact

For security issues, please contact the development team via responsible disclosure.

---

**Last Updated**: 2025-01
**Version**: 1.0.0
**Status**: DEVNET ONLY - NOT AUDITED FOR MAINNET
