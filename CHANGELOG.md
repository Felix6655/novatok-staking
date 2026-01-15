# Changelog

## [0.1.1] - 2025-01-15

### Changed
- Updated `Anchor.toml` default cluster from `localnet` to `devnet`
- Added `[programs.mainnet]` section to Anchor.toml for future use

### Added
- `.env.example` - Environment configuration template
- `DEPLOYMENT.md` - Complete terminal-only deployment guide
- `SMOKE_TEST.md` - Post-deployment verification checklist
- `CHANGELOG.md` - This file

### Notes
- **Program ID must be updated** before deployment:
  1. Run `anchor build` to generate keypair
  2. Get ID: `solana-keygen pubkey target/deploy/nova_staking-keypair.json`
  3. Update `declare_id!()` in `programs/nova_staking/src/lib.rs`
  4. Update `[programs.devnet]` in `Anchor.toml`
  5. Run `anchor build` again

## [0.1.0] - Initial Release

### Features
- Three-tier staking system (Flex, Core, Prime)
- Time-locked staking with 90-day and 180-day periods
- Linear reward accrual based on APY
- Treasury-funded rewards with emission cap
- Admin controls (pause, APY adjustment, emission cap update)
- Comprehensive test suite

### Technical
- Anchor framework 0.29.0
- Safe integer math throughout
- PDA-based vault and treasury security
- Full error code coverage
