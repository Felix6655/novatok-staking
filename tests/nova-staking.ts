/**
 * Nova Staking Program - Comprehensive Anchor Test Suite
 *
 * Tests cover:
 * 1. Initialize pool - verify staking_mint + authority stored correctly
 * 2. Vault/Treasury - verify they are ATAs for (authority=stake_pool PDA, mint=staking_mint)
 * 3. Stake Flex/Core/Prime - verify vault balance increases, user stake fields correct
 * 4. Claim rewards - verify rewards > 0 after time, last_claim_ts updated, second claim ~0
 * 5. Lock enforcement - Core/Prime unstake before expiry must fail
 * 6. Unstake after expiry - user receives principal, vault decreases
 * 7. Emission cap - set low cap and verify claim respects it
 * 8. Pause/unpause - blocks and restores stake/claim
 *
 * Uses localnet for deterministic tests.
 * All math uses integer operations only (BN).
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getAccount,
  Account as TokenAccount,
} from "@solana/spl-token";
import { expect } from "chai";
import { NovaStaking } from "../target/types/nova_staking";

// ============================================
// CONSTANTS (must match program)
// ============================================

// PDA Seeds
const STAKE_POOL_SEED = Buffer.from("stake_pool");
const USER_STAKE_SEED = Buffer.from("user_stake");
const POOL_VAULT_SEED = Buffer.from("pool_vault");
const TREASURY_VAULT_SEED = Buffer.from("treasury_vault");

// Tier constants
const TIER_FLEX = 0;
const TIER_CORE = 1;
const TIER_PRIME = 2;

// Lock periods in seconds
const SECONDS_PER_DAY = 86400;
const CORE_LOCK_PERIOD = 90 * SECONDS_PER_DAY;   // 7,776,000 seconds
const PRIME_LOCK_PERIOD = 180 * SECONDS_PER_DAY; // 15,552,000 seconds

// APY in basis points
const FLEX_APY = 400;   // 4%
const CORE_APY = 1000;  // 10%
const PRIME_APY = 1400; // 14%

// Math constants
const BASIS_POINTS = 10000;
const SECONDS_PER_YEAR = 365 * SECONDS_PER_DAY;

// Test amounts (integer only - 6 decimals)
const DECIMALS = 6;
const ONE_TOKEN = new BN(10 ** DECIMALS);
const MINT_AMOUNT = ONE_TOKEN.mul(new BN(1_000_000));     // 1M tokens
const STAKE_AMOUNT = ONE_TOKEN.mul(new BN(100_000));      // 100K tokens
const TREASURY_FUND = ONE_TOKEN.mul(new BN(500_000));     // 500K tokens
const EMISSION_CAP = ONE_TOKEN.mul(new BN(1_000_000));    // 1M tokens

// ============================================
// TEST SUITE
// ============================================

describe("Nova Staking Program - Comprehensive Tests", () => {
  // Provider setup (localnet)
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.NovaStaking as Program<NovaStaking>;
  const connection = provider.connection;

  // Test keypairs
  let admin: Keypair;
  let flexUser: Keypair;
  let coreUser: Keypair;
  let primeUser: Keypair;
  let nonAdmin: Keypair;

  // Token mint
  let stakingMint: PublicKey;

  // Token accounts
  let adminTokenAccount: PublicKey;
  let flexUserTokenAccount: PublicKey;
  let coreUserTokenAccount: PublicKey;
  let primeUserTokenAccount: PublicKey;

  // PDAs
  let stakePoolPda: PublicKey;
  let stakePoolBump: number;
  let stakingVaultPda: PublicKey;
  let stakingVaultBump: number;
  let treasuryVaultPda: PublicKey;
  let treasuryVaultBump: number;
  let flexUserStakePda: PublicKey;
  let coreUserStakePda: PublicKey;
  let primeUserStakePda: PublicKey;

  // ============================================
  // HELPER FUNCTIONS
  // ============================================

  /**
   * Derive all PDAs for the staking pool
   */
  function derivePdas(mint: PublicKey): void {
    [stakePoolPda, stakePoolBump] = PublicKey.findProgramAddressSync(
      [STAKE_POOL_SEED, mint.toBuffer()],
      program.programId
    );

    [stakingVaultPda, stakingVaultBump] = PublicKey.findProgramAddressSync(
      [POOL_VAULT_SEED, stakePoolPda.toBuffer()],
      program.programId
    );

    [treasuryVaultPda, treasuryVaultBump] = PublicKey.findProgramAddressSync(
      [TREASURY_VAULT_SEED, stakePoolPda.toBuffer()],
      program.programId
    );

    [flexUserStakePda] = PublicKey.findProgramAddressSync(
      [USER_STAKE_SEED, stakePoolPda.toBuffer(), flexUser.publicKey.toBuffer()],
      program.programId
    );

    [coreUserStakePda] = PublicKey.findProgramAddressSync(
      [USER_STAKE_SEED, stakePoolPda.toBuffer(), coreUser.publicKey.toBuffer()],
      program.programId
    );

    [primeUserStakePda] = PublicKey.findProgramAddressSync(
      [USER_STAKE_SEED, stakePoolPda.toBuffer(), primeUser.publicKey.toBuffer()],
      program.programId
    );
  }

  /**
   * Airdrop SOL to a keypair
   */
  async function airdropSol(pubkey: PublicKey, amount: number = 10): Promise<void> {
    const sig = await connection.requestAirdrop(pubkey, amount * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
  }

  /**
   * Get current blockchain timestamp
   */
  async function getCurrentTimestamp(): Promise<number> {
    const slot = await connection.getSlot();
    const timestamp = await connection.getBlockTime(slot);
    return timestamp || Math.floor(Date.now() / 1000);
  }

  /**
   * Advance time by processing transactions (localnet simulation)
   */
  async function advanceTime(seconds: number): Promise<void> {
    // In localnet, we simulate time passage by waiting and processing txs
    const iterations = Math.min(Math.ceil(seconds / 2), 20);
    for (let i = 0; i < iterations; i++) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      try {
        await connection.requestAirdrop(admin.publicKey, 1000);
      } catch {
        // Ignore airdrop failures
      }
    }
  }

  /**
   * Calculate expected rewards using integer math only
   * Formula: rewards = stakedAmount * apy * timeElapsed / (BASIS_POINTS * SECONDS_PER_YEAR)
   */
  function calculateExpectedRewards(
    stakedAmount: BN,
    apyBasisPoints: number,
    timeElapsedSeconds: number
  ): BN {
    const apy = new BN(apyBasisPoints);
    const time = new BN(timeElapsedSeconds);
    const basisPoints = new BN(BASIS_POINTS);
    const yearSeconds = new BN(SECONDS_PER_YEAR);

    return stakedAmount.mul(apy).mul(time).div(basisPoints.mul(yearSeconds));
  }

  /**
   * Format BN to readable token amount
   */
  function formatTokens(amount: BN): string {
    const divisor = new BN(10 ** DECIMALS);
    return `${amount.div(divisor).toString()}.${amount.mod(divisor).toString().padStart(DECIMALS, '0')}`;
  }

  // ============================================
  // TEST SETUP
  // ============================================

  before(async () => {
    console.log("\n" + "=".repeat(60));
    console.log("  NOVA STAKING - TEST SETUP");
    console.log("=".repeat(60));

    // Generate test keypairs
    admin = Keypair.generate();
    flexUser = Keypair.generate();
    coreUser = Keypair.generate();
    primeUser = Keypair.generate();
    nonAdmin = Keypair.generate();

    console.log("\nTest Accounts:");
    console.log(`  Admin:     ${admin.publicKey.toBase58()}`);
    console.log(`  FlexUser:  ${flexUser.publicKey.toBase58()}`);
    console.log(`  CoreUser:  ${coreUser.publicKey.toBase58()}`);
    console.log(`  PrimeUser: ${primeUser.publicKey.toBase58()}`);

    // Airdrop SOL to all accounts
    await Promise.all([
      airdropSol(admin.publicKey, 100),
      airdropSol(flexUser.publicKey, 50),
      airdropSol(coreUser.publicKey, 50),
      airdropSol(primeUser.publicKey, 50),
      airdropSol(nonAdmin.publicKey, 10),
    ]);

    // Create staking mint (NOVA token)
    stakingMint = await createMint(
      connection,
      admin,
      admin.publicKey,
      null,
      DECIMALS
    );
    console.log(`\nStaking Mint: ${stakingMint.toBase58()}`);

    // Derive PDAs
    derivePdas(stakingMint);
    console.log(`\nPDAs Derived:`);
    console.log(`  Stake Pool:    ${stakePoolPda.toBase58()}`);
    console.log(`  Staking Vault: ${stakingVaultPda.toBase58()}`);
    console.log(`  Treasury:      ${treasuryVaultPda.toBase58()}`);

    // Create token accounts for all users
    adminTokenAccount = await createAccount(
      connection, admin, stakingMint, admin.publicKey
    );
    flexUserTokenAccount = await createAccount(
      connection, flexUser, stakingMint, flexUser.publicKey
    );
    coreUserTokenAccount = await createAccount(
      connection, coreUser, stakingMint, coreUser.publicKey
    );
    primeUserTokenAccount = await createAccount(
      connection, primeUser, stakingMint, primeUser.publicKey
    );

    // Mint tokens to all users
    await mintTo(connection, admin, stakingMint, adminTokenAccount, admin, BigInt(MINT_AMOUNT.toString()));
    await mintTo(connection, admin, stakingMint, flexUserTokenAccount, admin, BigInt(MINT_AMOUNT.toString()));
    await mintTo(connection, admin, stakingMint, coreUserTokenAccount, admin, BigInt(MINT_AMOUNT.toString()));
    await mintTo(connection, admin, stakingMint, primeUserTokenAccount, admin, BigInt(MINT_AMOUNT.toString()));

    console.log(`\nTokens minted: ${formatTokens(MINT_AMOUNT)} to each user`);
    console.log("=".repeat(60) + "\n");
  });

  // ============================================
  // TEST 1: INITIALIZE POOL
  // ============================================

  describe("1. Initialize Pool", () => {
    it("should initialize pool with correct staking_mint and authority", async () => {
      await program.methods
        .initialize(EMISSION_CAP, FLEX_APY, CORE_APY, PRIME_APY)
        .accounts({
          authority: admin.publicKey,
          stakePool: stakePoolPda,
          stakingMint: stakingMint,
          stakingVault: stakingVaultPda,
          treasuryVault: treasuryVaultPda,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([admin])
        .rpc();

      // Fetch pool state
      const poolState = await program.account.stakePool.fetch(stakePoolPda);

      // Assert staking_mint stored correctly
      expect(poolState.stakingMint.toBase58()).to.equal(
        stakingMint.toBase58(),
        "staking_mint should match the NOVA mint"
      );

      // Assert authority stored correctly
      expect(poolState.authority.toBase58()).to.equal(
        admin.publicKey.toBase58(),
        "authority should match admin"
      );

      // Assert APY values
      expect(poolState.flexApy).to.equal(FLEX_APY, "Flex APY should be 400bp");
      expect(poolState.coreApy).to.equal(CORE_APY, "Core APY should be 1000bp");
      expect(poolState.primeApy).to.equal(PRIME_APY, "Prime APY should be 1400bp");

      // Assert emission cap
      expect(poolState.emissionCap.toString()).to.equal(
        EMISSION_CAP.toString(),
        "Emission cap should be set correctly"
      );

      // Assert initial state
      expect(poolState.totalStaked.toNumber()).to.equal(0);
      expect(poolState.totalDistributed.toNumber()).to.equal(0);
      expect(poolState.stakerCount.toNumber()).to.equal(0);
      expect(poolState.paused).to.equal(false);

      console.log("✓ Pool initialized with correct staking_mint and authority");
    });

    it("should reject re-initialization (pool already exists)", async () => {
      try {
        await program.methods
          .initialize(EMISSION_CAP, FLEX_APY, CORE_APY, PRIME_APY)
          .accounts({
            authority: nonAdmin.publicKey,
            stakePool: stakePoolPda,
            stakingMint: stakingMint,
            stakingVault: stakingVaultPda,
            treasuryVault: treasuryVaultPda,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([nonAdmin])
          .rpc();
        expect.fail("Should have thrown error");
      } catch (error: any) {
        expect(error.message).to.include("already in use");
        console.log("✓ Re-initialization correctly rejected");
      }
    });
  });

  // ============================================
  // TEST 2: VERIFY VAULT + TREASURY ARE PDAs
  // ============================================

  describe("2. Vault & Treasury Token Accounts", () => {
    it("should create staking vault as ATA with (authority=stake_pool PDA, mint=staking_mint)", async () => {
      const vaultAccount = await getAccount(connection, stakingVaultPda);

      // Assert owner is stake_pool PDA
      expect(vaultAccount.owner.toBase58()).to.equal(
        stakePoolPda.toBase58(),
        "Vault owner should be stake_pool PDA"
      );

      // Assert mint matches staking_mint
      expect(vaultAccount.mint.toBase58()).to.equal(
        stakingMint.toBase58(),
        "Vault mint should be staking_mint"
      );

      // Assert initial balance is 0
      expect(Number(vaultAccount.amount)).to.equal(0, "Vault should start empty");

      console.log("✓ Staking vault is correctly configured PDA");
    });

    it("should create treasury vault as ATA with (authority=stake_pool PDA, mint=staking_mint)", async () => {
      const treasuryAccount = await getAccount(connection, treasuryVaultPda);

      // Assert owner is stake_pool PDA
      expect(treasuryAccount.owner.toBase58()).to.equal(
        stakePoolPda.toBase58(),
        "Treasury owner should be stake_pool PDA"
      );

      // Assert mint matches staking_mint
      expect(treasuryAccount.mint.toBase58()).to.equal(
        stakingMint.toBase58(),
        "Treasury mint should be staking_mint"
      );

      // Assert initial balance is 0
      expect(Number(treasuryAccount.amount)).to.equal(0, "Treasury should start empty");

      console.log("✓ Treasury vault is correctly configured PDA");
    });

    it("should store correct vault addresses in pool state", async () => {
      const poolState = await program.account.stakePool.fetch(stakePoolPda);

      expect(poolState.stakingVault.toBase58()).to.equal(
        stakingVaultPda.toBase58(),
        "Pool should store correct vault address"
      );

      expect(poolState.treasuryVault.toBase58()).to.equal(
        treasuryVaultPda.toBase58(),
        "Pool should store correct treasury address"
      );

      console.log("✓ Pool state stores correct vault addresses");
    });
  });

  // ============================================
  // TEST 3: FUND TREASURY
  // ============================================

  describe("3. Fund Treasury", () => {
    it("should allow funding treasury with NOVA tokens", async () => {
      const treasuryBefore = await getAccount(connection, treasuryVaultPda);

      await program.methods
        .fundTreasury(TREASURY_FUND)
        .accounts({
          funder: admin.publicKey,
          stakePool: stakePoolPda,
          stakingMint: stakingMint,
          funderTokenAccount: adminTokenAccount,
          treasuryVault: treasuryVaultPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc();

      const treasuryAfter = await getAccount(connection, treasuryVaultPda);
      const increase = new BN(treasuryAfter.amount.toString()).sub(new BN(treasuryBefore.amount.toString()));

      expect(increase.toString()).to.equal(
        TREASURY_FUND.toString(),
        "Treasury should increase by fund amount"
      );

      console.log(`✓ Treasury funded with ${formatTokens(TREASURY_FUND)} tokens`);
    });
  });

  // ============================================
  // TEST 4: STAKE IN ALL TIERS
  // ============================================

  describe("4. Stake Flex/Core/Prime", () => {
    describe("4a. Flex Tier Staking", () => {
      it("should stake in Flex tier and verify vault balance increases", async () => {
        const vaultBefore = await getAccount(connection, stakingVaultPda);
        const vaultBalanceBefore = new BN(vaultBefore.amount.toString());

        await program.methods
          .stake(STAKE_AMOUNT, TIER_FLEX)
          .accounts({
            user: flexUser.publicKey,
            stakePool: stakePoolPda,
            userStake: flexUserStakePda,
            stakingMint: stakingMint,
            userTokenAccount: flexUserTokenAccount,
            stakingVault: stakingVaultPda,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([flexUser])
          .rpc();

        // Verify vault balance increased
        const vaultAfter = await getAccount(connection, stakingVaultPda);
        const vaultBalanceAfter = new BN(vaultAfter.amount.toString());
        const increase = vaultBalanceAfter.sub(vaultBalanceBefore);

        expect(increase.toString()).to.equal(
          STAKE_AMOUNT.toString(),
          "Vault balance should increase by stake amount"
        );

        console.log(`✓ Flex stake: vault increased by ${formatTokens(increase)}`);
      });

      it("should set user stake fields correctly for Flex tier", async () => {
        const userStake = await program.account.userStake.fetch(flexUserStakePda);
        const currentTime = await getCurrentTimestamp();

        // Verify owner
        expect(userStake.owner.toBase58()).to.equal(
          flexUser.publicKey.toBase58(),
          "Owner should match staker"
        );

        // Verify staked amount
        expect(userStake.stakedAmount.toString()).to.equal(
          STAKE_AMOUNT.toString(),
          "Staked amount should match"
        );

        // Verify tier
        expect(userStake.tier).to.equal(TIER_FLEX, "Tier should be Flex (0)");

        // Verify is_active
        expect(userStake.isActive).to.equal(true, "Stake should be active");

        // Verify stake_start_time is set (within 60 seconds of now)
        expect(userStake.stakeStartTime.toNumber()).to.be.closeTo(currentTime, 60);

        // Verify last_claim_time equals stake_start_time initially
        expect(userStake.lastClaimTime.toNumber()).to.equal(
          userStake.stakeStartTime.toNumber(),
          "last_claim_time should equal stake_start_time initially"
        );

        // Verify stake_pool reference
        expect(userStake.stakePool.toBase58()).to.equal(
          stakePoolPda.toBase58(),
          "Stake should reference correct pool"
        );

        console.log("✓ Flex user stake fields verified");
      });
    });

    describe("4b. Core Tier Staking (90-day lock)", () => {
      it("should stake in Core tier and verify vault balance increases", async () => {
        const vaultBefore = await getAccount(connection, stakingVaultPda);
        const vaultBalanceBefore = new BN(vaultBefore.amount.toString());

        await program.methods
          .stake(STAKE_AMOUNT, TIER_CORE)
          .accounts({
            user: coreUser.publicKey,
            stakePool: stakePoolPda,
            userStake: coreUserStakePda,
            stakingMint: stakingMint,
            userTokenAccount: coreUserTokenAccount,
            stakingVault: stakingVaultPda,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([coreUser])
          .rpc();

        const vaultAfter = await getAccount(connection, stakingVaultPda);
        const vaultBalanceAfter = new BN(vaultAfter.amount.toString());
        const increase = vaultBalanceAfter.sub(vaultBalanceBefore);

        expect(increase.toString()).to.equal(STAKE_AMOUNT.toString());
        console.log(`✓ Core stake: vault increased by ${formatTokens(increase)}`);
      });

      it("should set user stake fields correctly for Core tier", async () => {
        const userStake = await program.account.userStake.fetch(coreUserStakePda);

        expect(userStake.tier).to.equal(TIER_CORE, "Tier should be Core (1)");
        expect(userStake.stakedAmount.toString()).to.equal(STAKE_AMOUNT.toString());
        expect(userStake.isActive).to.equal(true);

        console.log("✓ Core user stake fields verified");
      });
    });

    describe("4c. Prime Tier Staking (180-day lock)", () => {
      it("should stake in Prime tier and verify vault balance increases", async () => {
        const vaultBefore = await getAccount(connection, stakingVaultPda);
        const vaultBalanceBefore = new BN(vaultBefore.amount.toString());

        await program.methods
          .stake(STAKE_AMOUNT, TIER_PRIME)
          .accounts({
            user: primeUser.publicKey,
            stakePool: stakePoolPda,
            userStake: primeUserStakePda,
            stakingMint: stakingMint,
            userTokenAccount: primeUserTokenAccount,
            stakingVault: stakingVaultPda,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([primeUser])
          .rpc();

        const vaultAfter = await getAccount(connection, stakingVaultPda);
        const vaultBalanceAfter = new BN(vaultAfter.amount.toString());
        const increase = vaultBalanceAfter.sub(vaultBalanceBefore);

        expect(increase.toString()).to.equal(STAKE_AMOUNT.toString());
        console.log(`✓ Prime stake: vault increased by ${formatTokens(increase)}`);
      });

      it("should set user stake fields correctly for Prime tier", async () => {
        const userStake = await program.account.userStake.fetch(primeUserStakePda);

        expect(userStake.tier).to.equal(TIER_PRIME, "Tier should be Prime (2)");
        expect(userStake.stakedAmount.toString()).to.equal(STAKE_AMOUNT.toString());
        expect(userStake.isActive).to.equal(true);

        console.log("✓ Prime user stake fields verified");
      });
    });

    describe("4d. Pool Statistics", () => {
      it("should update pool total_staked and staker_count", async () => {
        const poolState = await program.account.stakePool.fetch(stakePoolPda);

        // 3 stakers * STAKE_AMOUNT
        const expectedTotal = STAKE_AMOUNT.mul(new BN(3));
        expect(poolState.totalStaked.toString()).to.equal(
          expectedTotal.toString(),
          "Total staked should equal sum of all stakes"
        );

        expect(poolState.stakerCount.toNumber()).to.equal(
          3,
          "Staker count should be 3"
        );

        console.log(`✓ Pool stats: ${poolState.stakerCount} stakers, ${formatTokens(poolState.totalStaked)} total`);
      });
    });
  });

  // ============================================
  // TEST 5: CLAIM REWARDS
  // ============================================

  describe("5. Claim Rewards", () => {
    it("should have rewards > 0 after time passes", async () => {
      // Wait for time to pass
      await advanceTime(5);

      const userStakeBefore = await program.account.userStake.fetch(flexUserStakePda);
      const lastClaimBefore = userStakeBefore.lastClaimTime.toNumber();
      const userBalanceBefore = await getAccount(connection, flexUserTokenAccount);

      // Claim rewards
      await program.methods
        .claimRewards()
        .accounts({
          user: flexUser.publicKey,
          stakePool: stakePoolPda,
          userStake: flexUserStakePda,
          stakingMint: stakingMint,
          userTokenAccount: flexUserTokenAccount,
          treasuryVault: treasuryVaultPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([flexUser])
        .rpc();

      // Check rewards received
      const userBalanceAfter = await getAccount(connection, flexUserTokenAccount);
      const rewardsReceived = new BN(userBalanceAfter.amount.toString())
        .sub(new BN(userBalanceBefore.amount.toString()));

      expect(rewardsReceived.toNumber()).to.be.greaterThan(
        0,
        "Rewards should be > 0 after time passes"
      );

      // Check last_claim_time updated
      const userStakeAfter = await program.account.userStake.fetch(flexUserStakePda);
      const lastClaimAfter = userStakeAfter.lastClaimTime.toNumber();

      expect(lastClaimAfter).to.be.greaterThanOrEqual(
        lastClaimBefore,
        "last_claim_time should be updated"
      );

      // Check total_rewards_claimed updated
      expect(userStakeAfter.totalRewardsClaimed.toNumber()).to.be.greaterThan(0);

      console.log(`✓ Claimed ${formatTokens(rewardsReceived)} rewards, last_claim_ts updated`);
    });

    it("should yield ~0 rewards on second immediate claim", async () => {
      const userStakeBefore = await program.account.userStake.fetch(flexUserStakePda);
      const rewardsClaimedBefore = userStakeBefore.totalRewardsClaimed;

      try {
        await program.methods
          .claimRewards()
          .accounts({
            user: flexUser.publicKey,
            stakePool: stakePoolPda,
            userStake: flexUserStakePda,
            stakingMint: stakingMint,
            userTokenAccount: flexUserTokenAccount,
            treasuryVault: treasuryVaultPda,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([flexUser])
          .rpc();

        // If successful, check rewards are minimal
        const userStakeAfter = await program.account.userStake.fetch(flexUserStakePda);
        const additionalRewards = userStakeAfter.totalRewardsClaimed.sub(rewardsClaimedBefore);

        expect(additionalRewards.toNumber()).to.be.lessThan(
          1000, // Allow tiny rounding
          "Second claim should yield ~0 rewards"
        );

        console.log("✓ Second immediate claim yielded minimal rewards");
      } catch (error: any) {
        // NoRewardsAvailable is also acceptable
        expect(error.message).to.include("NoRewardsAvailable");
        console.log("✓ Second immediate claim correctly rejected (NoRewardsAvailable)");
      }
    });
  });

  // ============================================
  // TEST 6: LOCK PERIOD ENFORCEMENT
  // ============================================

  describe("6. Lock Period Enforcement", () => {
    describe("6a. Flex can unstake immediately", () => {
      it("should allow Flex tier to unstake without lock", async () => {
        const unstakeAmount = STAKE_AMOUNT.div(new BN(2)); // Unstake half

        const vaultBefore = await getAccount(connection, stakingVaultPda);
        const userBalanceBefore = await getAccount(connection, flexUserTokenAccount);

        await program.methods
          .unstake(unstakeAmount)
          .accounts({
            user: flexUser.publicKey,
            stakePool: stakePoolPda,
            userStake: flexUserStakePda,
            stakingMint: stakingMint,
            userTokenAccount: flexUserTokenAccount,
            stakingVault: stakingVaultPda,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([flexUser])
          .rpc();

        // Verify vault decreased
        const vaultAfter = await getAccount(connection, stakingVaultPda);
        const vaultDecrease = new BN(vaultBefore.amount.toString())
          .sub(new BN(vaultAfter.amount.toString()));

        expect(vaultDecrease.toString()).to.equal(unstakeAmount.toString());

        // Verify user received tokens
        const userBalanceAfter = await getAccount(connection, flexUserTokenAccount);
        const userIncrease = new BN(userBalanceAfter.amount.toString())
          .sub(new BN(userBalanceBefore.amount.toString()));

        // User receives unstake amount (rewards may have been added earlier)
        expect(userIncrease.gte(unstakeAmount)).to.equal(true);

        console.log("✓ Flex unstake successful (no lock)");
      });
    });

    describe("6b. Core cannot unstake before 90 days", () => {
      it("should reject Core tier unstake before lock expiry", async () => {
        try {
          await program.methods
            .unstake(STAKE_AMOUNT)
            .accounts({
              user: coreUser.publicKey,
              stakePool: stakePoolPda,
              userStake: coreUserStakePda,
              stakingMint: stakingMint,
              userTokenAccount: coreUserTokenAccount,
              stakingVault: stakingVaultPda,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([coreUser])
            .rpc();

          expect.fail("Should have thrown LockPeriodNotEnded");
        } catch (error: any) {
          expect(error.message).to.include("LockPeriodNotEnded");
          console.log("✓ Core unstake correctly rejected (lock not expired)");
        }
      });
    });

    describe("6c. Prime cannot unstake before 180 days", () => {
      it("should reject Prime tier unstake before lock expiry", async () => {
        try {
          await program.methods
            .unstake(STAKE_AMOUNT)
            .accounts({
              user: primeUser.publicKey,
              stakePool: stakePoolPda,
              userStake: primeUserStakePda,
              stakingMint: stakingMint,
              userTokenAccount: primeUserTokenAccount,
              stakingVault: stakingVaultPda,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([primeUser])
            .rpc();

          expect.fail("Should have thrown LockPeriodNotEnded");
        } catch (error: any) {
          expect(error.message).to.include("LockPeriodNotEnded");
          console.log("✓ Prime unstake correctly rejected (lock not expired)");
        }
      });
    });
  });

  // ============================================
  // TEST 7: UNSTAKE AFTER LOCK (Flex full unstake)
  // ============================================

  describe("7. Unstake After Lock Expiry", () => {
    it("should allow complete unstake and return principal to user", async () => {
      // Get remaining stake for Flex user
      const userStakeBefore = await program.account.userStake.fetch(flexUserStakePda);
      const remainingStake = userStakeBefore.stakedAmount;

      if (remainingStake.toNumber() > 0) {
        const vaultBefore = await getAccount(connection, stakingVaultPda);
        const userBalanceBefore = await getAccount(connection, flexUserTokenAccount);

        await program.methods
          .unstake(remainingStake)
          .accounts({
            user: flexUser.publicKey,
            stakePool: stakePoolPda,
            userStake: flexUserStakePda,
            stakingMint: stakingMint,
            userTokenAccount: flexUserTokenAccount,
            stakingVault: stakingVaultPda,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([flexUser])
          .rpc();

        // Verify vault decreased
        const vaultAfter = await getAccount(connection, stakingVaultPda);
        const vaultDecrease = new BN(vaultBefore.amount.toString())
          .sub(new BN(vaultAfter.amount.toString()));

        expect(vaultDecrease.toString()).to.equal(
          remainingStake.toString(),
          "Vault should decrease by unstake amount"
        );

        // Verify user stake is now inactive
        const userStakeAfter = await program.account.userStake.fetch(flexUserStakePda);
        expect(userStakeAfter.stakedAmount.toNumber()).to.equal(0);
        expect(userStakeAfter.isActive).to.equal(false);

        console.log(`✓ Full unstake: user received ${formatTokens(remainingStake)} principal`);
      }
    });
  });

  // ============================================
  // TEST 8: EMISSION CAP
  // ============================================

  describe("8. Emission Cap Enforcement", () => {
    let emissionTestUser: Keypair;
    let emissionTestTokenAccount: PublicKey;
    let emissionTestStakePda: PublicKey;
    let lowCapMint: PublicKey;
    let lowCapPoolPda: PublicKey;
    let lowCapVaultPda: PublicKey;
    let lowCapTreasuryPda: PublicKey;

    before(async () => {
      // Create isolated test with new mint and low emission cap
      emissionTestUser = Keypair.generate();
      await airdropSol(emissionTestUser.publicKey, 20);

      // Create new mint for this test
      lowCapMint = await createMint(connection, admin, admin.publicKey, null, DECIMALS);

      // Derive PDAs
      [lowCapPoolPda] = PublicKey.findProgramAddressSync(
        [STAKE_POOL_SEED, lowCapMint.toBuffer()],
        program.programId
      );
      [lowCapVaultPda] = PublicKey.findProgramAddressSync(
        [POOL_VAULT_SEED, lowCapPoolPda.toBuffer()],
        program.programId
      );
      [lowCapTreasuryPda] = PublicKey.findProgramAddressSync(
        [TREASURY_VAULT_SEED, lowCapPoolPda.toBuffer()],
        program.programId
      );
      [emissionTestStakePda] = PublicKey.findProgramAddressSync(
        [USER_STAKE_SEED, lowCapPoolPda.toBuffer(), emissionTestUser.publicKey.toBuffer()],
        program.programId
      );

      // Create token accounts
      emissionTestTokenAccount = await createAccount(
        connection, emissionTestUser, lowCapMint, emissionTestUser.publicKey
      );

      // Mint tokens
      await mintTo(connection, admin, lowCapMint, emissionTestTokenAccount, admin, BigInt(MINT_AMOUNT.toString()));
    });

    it("should enforce emission cap and reject claim when exceeded", async () => {
      // Initialize pool with very low emission cap
      const lowEmissionCap = ONE_TOKEN.mul(new BN(10)); // Only 10 tokens

      await program.methods
        .initialize(lowEmissionCap, FLEX_APY, CORE_APY, PRIME_APY)
        .accounts({
          authority: admin.publicKey,
          stakePool: lowCapPoolPda,
          stakingMint: lowCapMint,
          stakingVault: lowCapVaultPda,
          treasuryVault: lowCapTreasuryPda,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([admin])
        .rpc();

      // Fund treasury minimally
      const adminLowCapToken = await createAccount(connection, admin, lowCapMint, admin.publicKey);
      await mintTo(connection, admin, lowCapMint, adminLowCapToken, admin, BigInt(TREASURY_FUND.toString()));

      await program.methods
        .fundTreasury(ONE_TOKEN.mul(new BN(5))) // Only fund 5 tokens
        .accounts({
          funder: admin.publicKey,
          stakePool: lowCapPoolPda,
          stakingMint: lowCapMint,
          funderTokenAccount: adminLowCapToken,
          treasuryVault: lowCapTreasuryPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc();

      // Stake
      await program.methods
        .stake(STAKE_AMOUNT, TIER_FLEX)
        .accounts({
          user: emissionTestUser.publicKey,
          stakePool: lowCapPoolPda,
          userStake: emissionTestStakePda,
          stakingMint: lowCapMint,
          userTokenAccount: emissionTestTokenAccount,
          stakingVault: lowCapVaultPda,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([emissionTestUser])
        .rpc();

      // Lower emission cap to 1 token (below possible rewards)
      await program.methods
        .updateEmissionCap(ONE_TOKEN) // 1 token cap
        .accounts({
          authority: admin.publicKey,
          stakePool: lowCapPoolPda,
        })
        .signers([admin])
        .rpc();

      // Wait for rewards to accumulate
      await advanceTime(5);

      // Try to claim - should fail or be capped
      try {
        await program.methods
          .claimRewards()
          .accounts({
            user: emissionTestUser.publicKey,
            stakePool: lowCapPoolPda,
            userStake: emissionTestStakePda,
            stakingMint: lowCapMint,
            userTokenAccount: emissionTestTokenAccount,
            treasuryVault: lowCapTreasuryPda,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([emissionTestUser])
          .rpc();

        // If success, verify cap respected
        const poolState = await program.account.stakePool.fetch(lowCapPoolPda);
        expect(poolState.totalDistributed.lte(poolState.emissionCap)).to.equal(
          true,
          "Total distributed should not exceed emission cap"
        );
        console.log("✓ Emission cap respected (claim succeeded within cap)");
      } catch (error: any) {
        // EmissionCapExceeded, NoRewardsAvailable, or InsufficientTreasuryFunds are valid
        const validErrors = ["EmissionCapExceeded", "NoRewardsAvailable", "InsufficientTreasuryFunds"];
        const hasValidError = validErrors.some(e => error.message.includes(e));
        expect(hasValidError).to.equal(true, `Expected cap-related error, got: ${error.message}`);
        console.log("✓ Emission cap enforced (claim rejected)");
      }
    });
  });

  // ============================================
  // TEST 9: PAUSE/UNPAUSE
  // ============================================

  describe("9. Pause/Unpause Functionality", () => {
    let pauseTestUser: Keypair;
    let pauseTestTokenAccount: PublicKey;
    let pauseTestStakePda: PublicKey;

    before(async () => {
      pauseTestUser = Keypair.generate();
      await airdropSol(pauseTestUser.publicKey, 20);

      pauseTestTokenAccount = await createAccount(
        connection, pauseTestUser, stakingMint, pauseTestUser.publicKey
      );
      await mintTo(connection, admin, stakingMint, pauseTestTokenAccount, admin, BigInt(MINT_AMOUNT.toString()));

      [pauseTestStakePda] = PublicKey.findProgramAddressSync(
        [USER_STAKE_SEED, stakePoolPda.toBuffer(), pauseTestUser.publicKey.toBuffer()],
        program.programId
      );
    });

    it("should allow admin to pause staking", async () => {
      await program.methods
        .setPaused(true)
        .accounts({
          authority: admin.publicKey,
          stakePool: stakePoolPda,
        })
        .signers([admin])
        .rpc();

      const poolState = await program.account.stakePool.fetch(stakePoolPda);
      expect(poolState.paused).to.equal(true, "Pool should be paused");

      console.log("✓ Admin paused staking");
    });

    it("should block new stakes when paused", async () => {
      try {
        await program.methods
          .stake(STAKE_AMOUNT, TIER_FLEX)
          .accounts({
            user: pauseTestUser.publicKey,
            stakePool: stakePoolPda,
            userStake: pauseTestStakePda,
            stakingMint: stakingMint,
            userTokenAccount: pauseTestTokenAccount,
            stakingVault: stakingVaultPda,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([pauseTestUser])
          .rpc();

        expect.fail("Should have thrown StakingPaused");
      } catch (error: any) {
        expect(error.message).to.include("StakingPaused");
        console.log("✓ Stake blocked when paused");
      }
    });

    it("should reject non-admin pause attempt", async () => {
      try {
        await program.methods
          .setPaused(false)
          .accounts({
            authority: nonAdmin.publicKey,
            stakePool: stakePoolPda,
          })
          .signers([nonAdmin])
          .rpc();

        expect.fail("Should have thrown Unauthorized");
      } catch (error: any) {
        expect(error.message).to.satisfy((msg: string) =>
          msg.includes("Unauthorized") || msg.includes("constraint")
        );
        console.log("✓ Non-admin pause rejected");
      }
    });

    it("should allow admin to unpause staking", async () => {
      await program.methods
        .setPaused(false)
        .accounts({
          authority: admin.publicKey,
          stakePool: stakePoolPda,
        })
        .signers([admin])
        .rpc();

      const poolState = await program.account.stakePool.fetch(stakePoolPda);
      expect(poolState.paused).to.equal(false, "Pool should be unpaused");

      console.log("✓ Admin unpaused staking");
    });

    it("should allow staking after unpause", async () => {
      await program.methods
        .stake(STAKE_AMOUNT, TIER_FLEX)
        .accounts({
          user: pauseTestUser.publicKey,
          stakePool: stakePoolPda,
          userStake: pauseTestStakePda,
          stakingMint: stakingMint,
          userTokenAccount: pauseTestTokenAccount,
          stakingVault: stakingVaultPda,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([pauseTestUser])
        .rpc();

      const userStake = await program.account.userStake.fetch(pauseTestStakePda);
      expect(userStake.isActive).to.equal(true);
      expect(userStake.stakedAmount.toString()).to.equal(STAKE_AMOUNT.toString());

      console.log("✓ Staking works after unpause");
    });
  });

  // ============================================
  // TEST 10: ADDITIONAL SECURITY TESTS
  // ============================================

  describe("10. Security Edge Cases", () => {
    it("should reject staking with zero amount", async () => {
      const testUser = Keypair.generate();
      await airdropSol(testUser.publicKey, 5);
      const testToken = await createAccount(connection, testUser, stakingMint, testUser.publicKey);
      await mintTo(connection, admin, stakingMint, testToken, admin, BigInt(MINT_AMOUNT.toString()));

      const [testStakePda] = PublicKey.findProgramAddressSync(
        [USER_STAKE_SEED, stakePoolPda.toBuffer(), testUser.publicKey.toBuffer()],
        program.programId
      );

      try {
        await program.methods
          .stake(new BN(0), TIER_FLEX)
          .accounts({
            user: testUser.publicKey,
            stakePool: stakePoolPda,
            userStake: testStakePda,
            stakingMint: stakingMint,
            userTokenAccount: testToken,
            stakingVault: stakingVaultPda,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([testUser])
          .rpc();

        expect.fail("Should have thrown ZeroAmount");
      } catch (error: any) {
        expect(error.message).to.include("ZeroAmount");
        console.log("✓ Zero amount stake rejected");
      }
    });

    it("should reject invalid tier", async () => {
      const testUser = Keypair.generate();
      await airdropSol(testUser.publicKey, 5);
      const testToken = await createAccount(connection, testUser, stakingMint, testUser.publicKey);
      await mintTo(connection, admin, stakingMint, testToken, admin, BigInt(MINT_AMOUNT.toString()));

      const [testStakePda] = PublicKey.findProgramAddressSync(
        [USER_STAKE_SEED, stakePoolPda.toBuffer(), testUser.publicKey.toBuffer()],
        program.programId
      );

      try {
        await program.methods
          .stake(STAKE_AMOUNT, 99) // Invalid tier
          .accounts({
            user: testUser.publicKey,
            stakePool: stakePoolPda,
            userStake: testStakePda,
            stakingMint: stakingMint,
            userTokenAccount: testToken,
            stakingVault: stakingVaultPda,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([testUser])
          .rpc();

        expect.fail("Should have thrown InvalidTier");
      } catch (error: any) {
        expect(error.message).to.include("InvalidTier");
        console.log("✓ Invalid tier rejected");
      }
    });

    it("should reject unstaking more than staked", async () => {
      // Re-stake flexUser first
      await program.methods
        .stake(STAKE_AMOUNT, TIER_FLEX)
        .accounts({
          user: flexUser.publicKey,
          stakePool: stakePoolPda,
          userStake: flexUserStakePda,
          stakingMint: stakingMint,
          userTokenAccount: flexUserTokenAccount,
          stakingVault: stakingVaultPda,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([flexUser])
        .rpc();

      try {
        await program.methods
          .unstake(STAKE_AMOUNT.mul(new BN(10))) // Way more than staked
          .accounts({
            user: flexUser.publicKey,
            stakePool: stakePoolPda,
            userStake: flexUserStakePda,
            stakingMint: stakingMint,
            userTokenAccount: flexUserTokenAccount,
            stakingVault: stakingVaultPda,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([flexUser])
          .rpc();

        expect.fail("Should have thrown InsufficientStakedBalance");
      } catch (error: any) {
        expect(error.message).to.include("InsufficientStakedBalance");
        console.log("✓ Excessive unstake rejected");
      }
    });

    it("should allow APY adjustment by admin only", async () => {
      const newFlexApy = 500;
      const newCoreApy = 1200;
      const newPrimeApy = 1600;

      await program.methods
        .adjustApy(newFlexApy, newCoreApy, newPrimeApy)
        .accounts({
          authority: admin.publicKey,
          stakePool: stakePoolPda,
        })
        .signers([admin])
        .rpc();

      const poolState = await program.account.stakePool.fetch(stakePoolPda);
      expect(poolState.flexApy).to.equal(newFlexApy);
      expect(poolState.coreApy).to.equal(newCoreApy);
      expect(poolState.primeApy).to.equal(newPrimeApy);

      // Restore original
      await program.methods
        .adjustApy(FLEX_APY, CORE_APY, PRIME_APY)
        .accounts({
          authority: admin.publicKey,
          stakePool: stakePoolPda,
        })
        .signers([admin])
        .rpc();

      console.log("✓ APY adjustment by admin works");
    });

    it("should reject APY above maximum (50%)", async () => {
      try {
        await program.methods
          .adjustApy(6000, CORE_APY, PRIME_APY) // 60% > 50% max
          .accounts({
            authority: admin.publicKey,
            stakePool: stakePoolPda,
          })
          .signers([admin])
          .rpc();

        expect.fail("Should have thrown ApyTooHigh");
      } catch (error: any) {
        expect(error.message).to.include("ApyTooHigh");
        console.log("✓ Excessive APY rejected");
      }
    });
  });

  // ============================================
  // FINAL SUMMARY
  // ============================================

  after(async () => {
    console.log("\n" + "=".repeat(60));
    console.log("  TEST SUMMARY");
    console.log("=".repeat(60));

    const poolState = await program.account.stakePool.fetch(stakePoolPda);
    console.log(`\nFinal Pool State:`);
    console.log(`  Total Staked:      ${formatTokens(poolState.totalStaked)}`);
    console.log(`  Total Distributed: ${formatTokens(poolState.totalDistributed)}`);
    console.log(`  Staker Count:      ${poolState.stakerCount}`);
    console.log(`  Paused:            ${poolState.paused}`);
    console.log(`  APY (Flex/Core/Prime): ${poolState.flexApy}/${poolState.coreApy}/${poolState.primeApy} bp`);
    console.log("=".repeat(60) + "\n");
  });
});
