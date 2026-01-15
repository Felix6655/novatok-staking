# Nova Staking - Smoke Test Checklist

Use this checklist to verify your deployment is working correctly on devnet.

## Prerequisites

- [ ] Program deployed to devnet
- [ ] Wallet has SOL for transactions (~0.5 SOL)
- [ ] Node.js dependencies installed (`yarn install`)

---

## Test 1: Create NOVA Token Mint

```bash
# Create a new SPL token mint for testing
spl-token create-token --decimals 6
# Output: Creating token <MINT_ADDRESS>
# Save this MINT_ADDRESS!

# Create token account
spl-token create-account <MINT_ADDRESS>

# Mint tokens to yourself (1 million for testing)
spl-token mint <MINT_ADDRESS> 1000000

# Verify balance
spl-token balance <MINT_ADDRESS>
# Should show: 1000000
```

**Checkpoint**: Token mint created and you have 1,000,000 tokens.

---

## Test 2: Initialize Staking Pool

```bash
# Using Anchor CLI with TypeScript
npx ts-node -e "
const anchor = require('@coral-xyz/anchor');
const { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID } = require('@solana/spl-token');

// Replace with your values
const MINT_ADDRESS = '<YOUR_MINT_ADDRESS>';
const PROGRAM_ID = '<YOUR_PROGRAM_ID>';
const EMISSION_CAP = 10_000_000_000_000; // 10M tokens (6 decimals)
const FLEX_APY = 400;  // 4%
const CORE_APY = 1000; // 10%
const PRIME_APY = 1400; // 14%

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const program = anchor.workspace.NovaStaking;
  const mint = new PublicKey(MINT_ADDRESS);
  
  // Derive PDAs
  const [stakePool] = PublicKey.findProgramAddressSync(
    [Buffer.from('stake_pool'), mint.toBuffer()],
    program.programId
  );
  const [stakingVault] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool_vault'), stakePool.toBuffer()],
    program.programId
  );
  const [treasuryVault] = PublicKey.findProgramAddressSync(
    [Buffer.from('treasury_vault'), stakePool.toBuffer()],
    program.programId
  );
  
  console.log('Stake Pool PDA:', stakePool.toBase58());
  console.log('Staking Vault PDA:', stakingVault.toBase58());
  console.log('Treasury Vault PDA:', treasuryVault.toBase58());
  
  const tx = await program.methods
    .initialize(new anchor.BN(EMISSION_CAP), FLEX_APY, CORE_APY, PRIME_APY)
    .accounts({
      authority: provider.wallet.publicKey,
      stakePool,
      stakingMint: mint,
      stakingVault,
      treasuryVault,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .rpc();
    
  console.log('Initialize TX:', tx);
}

main().catch(console.error);
"
```

**Expected**: Transaction succeeds, pool created.

**Verify**:
```bash
# Check pool state exists
solana account <STAKE_POOL_PDA>
```

---

## Test 3: Fund Treasury

```bash
# Fund treasury with reward tokens (500K tokens)
npx ts-node -e "
const anchor = require('@coral-xyz/anchor');
const { PublicKey } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } = require('@solana/spl-token');

const MINT_ADDRESS = '<YOUR_MINT_ADDRESS>';
const FUND_AMOUNT = 500_000_000_000; // 500K tokens (6 decimals)

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.NovaStaking;
  const mint = new PublicKey(MINT_ADDRESS);
  
  // Derive PDAs
  const [stakePool] = PublicKey.findProgramAddressSync(
    [Buffer.from('stake_pool'), mint.toBuffer()],
    program.programId
  );
  const [treasuryVault] = PublicKey.findProgramAddressSync(
    [Buffer.from('treasury_vault'), stakePool.toBuffer()],
    program.programId
  );
  
  const funderAta = await getAssociatedTokenAddress(mint, provider.wallet.publicKey);
  
  const tx = await program.methods
    .fundTreasury(new anchor.BN(FUND_AMOUNT))
    .accounts({
      funder: provider.wallet.publicKey,
      stakePool,
      stakingMint: mint,
      funderTokenAccount: funderAta,
      treasuryVault,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
    
  console.log('Fund Treasury TX:', tx);
}

main().catch(console.error);
"
```

**Expected**: Treasury funded with 500K tokens.

---

## Test 4: Stake Tokens (Flex Tier)

```bash
npx ts-node -e "
const anchor = require('@coral-xyz/anchor');
const { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } = require('@solana/spl-token');

const MINT_ADDRESS = '<YOUR_MINT_ADDRESS>';
const STAKE_AMOUNT = 100_000_000_000; // 100K tokens
const TIER_FLEX = 0;

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.NovaStaking;
  const mint = new PublicKey(MINT_ADDRESS);
  
  const [stakePool] = PublicKey.findProgramAddressSync(
    [Buffer.from('stake_pool'), mint.toBuffer()],
    program.programId
  );
  const [stakingVault] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool_vault'), stakePool.toBuffer()],
    program.programId
  );
  const [userStake] = PublicKey.findProgramAddressSync(
    [Buffer.from('user_stake'), stakePool.toBuffer(), provider.wallet.publicKey.toBuffer()],
    program.programId
  );
  
  const userAta = await getAssociatedTokenAddress(mint, provider.wallet.publicKey);
  
  const tx = await program.methods
    .stake(new anchor.BN(STAKE_AMOUNT), TIER_FLEX)
    .accounts({
      user: provider.wallet.publicKey,
      stakePool,
      userStake,
      stakingMint: mint,
      userTokenAccount: userAta,
      stakingVault,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .rpc();
    
  console.log('Stake TX:', tx);
}

main().catch(console.error);
"
```

**Expected**: 100K tokens staked in Flex tier.

---

## Test 5: Verify Lock Status

```bash
yarn stake-status --mint <YOUR_MINT_ADDRESS>

# Or directly:
npx ts-node scripts/stake-status.ts --mint <YOUR_MINT_ADDRESS>
```

**Expected Output**:
```
========================================
  Nova Staking - User Status
========================================

User: <your-wallet>
Stake Pool: <pool-pda>

Stake Status:
  Staked Amount: 100,000.000000 tokens
  Tier: Flex (0)
  Lock Period: No lock
  Stake Start: <timestamp>
  Lock End: N/A (Flex tier)
  Status: UNLOCKED ✓

Rewards:
  Pending Rewards: X.XXXXXX tokens
  Total Claimed: 0.000000 tokens
```

---

## Test 6: Claim Rewards

Wait a few minutes for rewards to accrue, then:

```bash
npx ts-node -e "
const anchor = require('@coral-xyz/anchor');
const { PublicKey } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } = require('@solana/spl-token');

const MINT_ADDRESS = '<YOUR_MINT_ADDRESS>';

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.NovaStaking;
  const mint = new PublicKey(MINT_ADDRESS);
  
  const [stakePool] = PublicKey.findProgramAddressSync(
    [Buffer.from('stake_pool'), mint.toBuffer()],
    program.programId
  );
  const [treasuryVault] = PublicKey.findProgramAddressSync(
    [Buffer.from('treasury_vault'), stakePool.toBuffer()],
    program.programId
  );
  const [userStake] = PublicKey.findProgramAddressSync(
    [Buffer.from('user_stake'), stakePool.toBuffer(), provider.wallet.publicKey.toBuffer()],
    program.programId
  );
  
  const userAta = await getAssociatedTokenAddress(mint, provider.wallet.publicKey);
  
  const tx = await program.methods
    .claimRewards()
    .accounts({
      user: provider.wallet.publicKey,
      stakePool,
      userStake,
      stakingMint: mint,
      userTokenAccount: userAta,
      treasuryVault,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
    
  console.log('Claim TX:', tx);
}

main().catch(console.error);
"
```

**Expected**: Rewards claimed (may be very small for short time periods).

---

## Test 7: Unstake (Flex Tier - No Lock)

```bash
npx ts-node -e "
const anchor = require('@coral-xyz/anchor');
const { PublicKey } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } = require('@solana/spl-token');

const MINT_ADDRESS = '<YOUR_MINT_ADDRESS>';
const UNSTAKE_AMOUNT = 50_000_000_000; // 50K tokens

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.NovaStaking;
  const mint = new PublicKey(MINT_ADDRESS);
  
  const [stakePool] = PublicKey.findProgramAddressSync(
    [Buffer.from('stake_pool'), mint.toBuffer()],
    program.programId
  );
  const [stakingVault] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool_vault'), stakePool.toBuffer()],
    program.programId
  );
  const [userStake] = PublicKey.findProgramAddressSync(
    [Buffer.from('user_stake'), stakePool.toBuffer(), provider.wallet.publicKey.toBuffer()],
    program.programId
  );
  
  const userAta = await getAssociatedTokenAddress(mint, provider.wallet.publicKey);
  
  const tx = await program.methods
    .unstake(new anchor.BN(UNSTAKE_AMOUNT))
    .accounts({
      user: provider.wallet.publicKey,
      stakePool,
      userStake,
      stakingMint: mint,
      userTokenAccount: userAta,
      stakingVault,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
    
  console.log('Unstake TX:', tx);
}

main().catch(console.error);
"
```

**Expected**: 50K tokens returned to wallet.

---

## Smoke Test Summary Checklist

| # | Test | Expected | Status |
|---|------|----------|--------|
| 1 | Create Token Mint | Mint created | [ ] |
| 2 | Initialize Pool | Pool PDA created | [ ] |
| 3 | Fund Treasury | Treasury has tokens | [ ] |
| 4 | Stake (Flex) | Tokens moved to vault | [ ] |
| 5 | Verify Lock | Shows correct stake info | [ ] |
| 6 | Claim Rewards | Rewards received | [ ] |
| 7 | Unstake | Tokens returned | [ ] |

---

## Lock Period Simulation (Core/Prime)

To fully test lock periods:

1. **Stake in Core tier** (90-day lock):
   - Change `TIER_FLEX` (0) to `TIER_CORE` (1) in stake script
   - Try to unstake immediately - should FAIL with `LockPeriodNotEnded`

2. **Stake in Prime tier** (180-day lock):
   - Change tier to `TIER_PRIME` (2)
   - Try to unstake immediately - should FAIL

Note: On devnet, you cannot fast-forward time. Lock period testing is limited to verifying the rejection works correctly.

---

## Common Issues

### "Account not found"
- Pool not initialized yet
- Wrong mint address

### "LockPeriodNotEnded"
- Working as expected for Core/Prime tiers

### "InsufficientTreasuryFunds"
- Fund treasury before claiming

### "EmissionCapExceeded"
- Increase emission cap or reduce claims
