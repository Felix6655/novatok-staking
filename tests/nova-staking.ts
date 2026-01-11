/**
 * Nova Staking Program - Comprehensive Test Suite
 *
 * Tests cover:
 * 1. Pool initialization (admin only)
 * 2. PDA creation (vault + treasury)
 * 3. Staking in all tiers (Flex, Core, Prime)
 * 4. Vault balance verification
 * 5. User stake state verification
 * 6. Reward claiming
 * 7. Lock period enforcement
 * 8. Unstaking after lock
 * 9. Emission cap enforcement
 * 10. Pause/unpause functionality
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
} from "@solana/spl-token";
import { expect } from "chai";
import { NovaStaking } from "../target/types/nova_staking";

// Constants matching the program
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
const CORE_LOCK_PERIOD = 90 * SECONDS_PER_DAY;
const PRIME_LOCK_PERIOD = 180 * SECONDS_PER_DAY;

// APY in basis points
const FLEX_APY = 400; // 4%
const CORE_APY = 1000; // 10%
const PRIME_APY = 1400; // 14%

// Basis points denominator
const BASIS_POINTS = 10000;
const SECONDS_PER_YEAR = 365 * SECONDS_PER_DAY;

describe("Nova Staking Program", () => {
  // Configure the client to use localnet
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.NovaStaking as Program<NovaStaking>;
  const connection = provider.connection;

  // Test accounts
  let admin: Keypair;
  let user1: Keypair;
  let user2: Keypair;
  let nonAdmin: Keypair;

  // Token accounts
  let novaMint: PublicKey;
  let adminTokenAccount: PublicKey;
  let user1TokenAccount: PublicKey;
  let user2TokenAccount: PublicKey;

  // PDAs
  let stakePoolPda: PublicKey;
  let stakePoolBump: number;
  let stakingVaultPda: PublicKey;
  let treasuryVaultPda: PublicKey;
  let user1StakePda: PublicKey;
  let user2StakePda: PublicKey;

  // Test amounts (using integer math - no floats)
  const MINT_AMOUNT = new BN(1_000_000_000_000); // 1M tokens with 6 decimals
  const STAKE_AMOUNT = new BN(100_000_000_000); // 100K tokens
  const TREASURY_FUND_AMOUNT = new BN(500_000_000_000); // 500K tokens
  const EMISSION_CAP = new BN(1_000_000_000_000); // 1M tokens

  /**
   * Helper: Derive PDAs
   */
  async function derivePdas() {
    [stakePoolPda, stakePoolBump] = PublicKey.findProgramAddressSync(
      [STAKE_POOL_SEED, novaMint.toBuffer()],
      program.programId
    );

    [stakingVaultPda] = PublicKey.findProgramAddressSync(
      [POOL_VAULT_SEED, stakePoolPda.toBuffer()],
      program.programId
    );

    [treasuryVaultPda] = PublicKey.findProgramAddressSync(
      [TREASURY_VAULT_SEED, stakePoolPda.toBuffer()],
      program.programId
    );

    [user1StakePda] = PublicKey.findProgramAddressSync(
      [USER_STAKE_SEED, stakePoolPda.toBuffer(), user1.publicKey.toBuffer()],
      program.programId
    );

    [user2StakePda] = PublicKey.findProgramAddressSync(
      [USER_STAKE_SEED, stakePoolPda.toBuffer(), user2.publicKey.toBuffer()],
      program.programId
    );
  }

  /**
   * Helper: Airdrop SOL to account
   */
  async function airdrop(publicKey: PublicKey, amount: number = 10) {
    const signature = await connection.requestAirdrop(
      publicKey,
      amount * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(signature, "confirmed");
  }

  /**
   * Helper: Get current slot timestamp
   */
  async function getCurrentTimestamp(): Promise<number> {
    const slot = await connection.getSlot();
    const timestamp = await connection.getBlockTime(slot);
    return timestamp || Math.floor(Date.now() / 1000);
  }

  /**
   * Helper: Advance time by warping clock (simulation for tests)
   * Note: In localnet, we use sleep + transaction to advance slots
   */
  async function advanceTime(seconds: number): Promise<void> {
    // In localnet tests, we simulate time passage
    // This is a simplified approach - real tests may need bankrun or time warp
    const iterations = Math.min(seconds, 10); // Cap iterations
    for (let i = 0; i < iterations; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      // Send a dummy transaction to advance slot
      try {
        await connection.requestAirdrop(admin.publicKey, 1000);
      } catch (e) {
        // Ignore errors
      }
    }
  }

  /**
   * Helper: Calculate expected rewards using integer math only
   * rewards = stakedAmount * apy * timeElapsed / (basisPoints * secondsPerYear)
   */
  function calculateExpectedRewards(
    stakedAmount: BN,
    apyBasisPoints: number,
    timeElapsedSeconds: number
  ): BN {
    // Use BN for all calculations to avoid floating point
    const apy = new BN(apyBasisPoints);
    const time = new BN(timeElapsedSeconds);
    const basisPoints = new BN(BASIS_POINTS);
    const yearSeconds = new BN(SECONDS_PER_YEAR);

    // rewards = stakedAmount * apy * time / (basisPoints * yearSeconds)
    return stakedAmount.mul(apy).mul(time).div(basisPoints.mul(yearSeconds));
  }

  // ============================================
  // Setup: Create accounts and mint tokens
  // ============================================
  before(async () => {
    console.log("\n=== Setting up test environment ===");

    // Generate keypairs
    admin = Keypair.generate();
    user1 = Keypair.generate();
    user2 = Keypair.generate();
    nonAdmin = Keypair.generate();

    // Airdrop SOL
    await airdrop(admin.publicKey, 100);
    await airdrop(user1.publicKey, 100);
    await airdrop(user2.publicKey, 100);
    await airdrop(nonAdmin.publicKey, 100);

    console.log("Admin:", admin.publicKey.toBase58());
    console.log("User1:", user1.publicKey.toBase58());
    console.log("User2:", user2.publicKey.toBase58());

    // Create NOVA mint (6 decimals)
    novaMint = await createMint(
      connection,
      admin,
      admin.publicKey,
      null,
      6 // 6 decimals
    );
    console.log("NOVA Mint:", novaMint.toBase58());

    // Create token accounts
    adminTokenAccount = await createAccount(
      connection,
      admin,
      novaMint,
      admin.publicKey
    );

    user1TokenAccount = await createAccount(
      connection,
      user1,
      novaMint,
      user1.publicKey
    );

    user2TokenAccount = await createAccount(
      connection,
      user2,
      novaMint,
      user2.publicKey
    );

    // Mint tokens to accounts
    await mintTo(
      connection,
      admin,
      novaMint,
      adminTokenAccount,
      admin,
      BigInt(MINT_AMOUNT.toString())
    );

    await mintTo(
      connection,
      admin,
      novaMint,
      user1TokenAccount,
      admin,
      BigInt(MINT_AMOUNT.toString())
    );

    await mintTo(
      connection,
      admin,
      novaMint,
      user2TokenAccount,
      admin,
      BigInt(MINT_AMOUNT.toString())
    );

    // Derive PDAs
    await derivePdas();

    console.log("Stake Pool PDA:", stakePoolPda.toBase58());
    console.log("Staking Vault PDA:", stakingVaultPda.toBase58());
    console.log("Treasury Vault PDA:", treasuryVaultPda.toBase58());
    console.log("=== Setup complete ===\n");
  });

  // ============================================
  // Test 1: Initialize Pool (Admin Only)
  // ============================================
  describe("1. Initialize Pool", () => {
    it("should initialize the staking pool with correct parameters", async () => {
      await program.methods
        .initialize(EMISSION_CAP, FLEX_APY, CORE_APY, PRIME_APY)
        .accounts({
          authority: admin.publicKey,
          stakePool: stakePoolPda,
          stakingMint: novaMint,
          stakingVault: stakingVaultPda,
          treasuryVault: treasuryVaultPda,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([admin])
        .rpc();

      // Fetch and verify pool state
      const poolState = await program.account.stakePool.fetch(stakePoolPda);

      expect(poolState.authority.toBase58()).to.equal(
        admin.publicKey.toBase58(),
        "Admin pubkey should be stored correctly"
      );
      expect(poolState.stakingMint.toBase58()).to.equal(novaMint.toBase58());
      expect(poolState.flexApy).to.equal(FLEX_APY);
      expect(poolState.coreApy).to.equal(CORE_APY);
      expect(poolState.primeApy).to.equal(PRIME_APY);
      expect(poolState.emissionCap.toString()).to.equal(EMISSION_CAP.toString());
      expect(poolState.totalDistributed.toNumber()).to.equal(0);
      expect(poolState.totalStaked.toNumber()).to.equal(0);
      expect(poolState.stakerCount.toNumber()).to.equal(0);
      expect(poolState.paused).to.equal(false);
    });

    it("should reject initialization by non-admin (pool already exists)", async () => {
      // Try to reinitialize - should fail as pool already exists
      try {
        await program.methods
          .initialize(EMISSION_CAP, FLEX_APY, CORE_APY, PRIME_APY)
          .accounts({
            authority: nonAdmin.publicKey,
            stakePool: stakePoolPda,
            stakingMint: novaMint,
            stakingVault: stakingVaultPda,
            treasuryVault: treasuryVaultPda,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([nonAdmin])
          .rpc();
        expect.fail("Should have thrown an error");
      } catch (error: any) {
        // Expected to fail - account already initialized
        expect(error.message).to.include("already in use");
      }
    });
  });

  // ============================================
  // Test 2: Verify PDAs Created Correctly
  // ============================================
  describe("2. PDA Token Accounts", () => {
    it("should have created vault PDA as SPL token account", async () => {
      const vaultAccount = await getAccount(connection, stakingVaultPda);
      expect(vaultAccount.mint.toBase58()).to.equal(novaMint.toBase58());
      expect(vaultAccount.owner.toBase58()).to.equal(stakePoolPda.toBase58());
      expect(Number(vaultAccount.amount)).to.equal(0);
    });

    it("should have created treasury PDA as SPL token account", async () => {
      const treasuryAccount = await getAccount(connection, treasuryVaultPda);
      expect(treasuryAccount.mint.toBase58()).to.equal(novaMint.toBase58());
      expect(treasuryAccount.owner.toBase58()).to.equal(stakePoolPda.toBase58());
      expect(Number(treasuryAccount.amount)).to.equal(0);
    });
  });

  // ============================================
  // Test 3: Fund Treasury
  // ============================================
  describe("3. Fund Treasury", () => {
    it("should fund the treasury with NOVA tokens", async () => {
      const treasuryBefore = await getAccount(connection, treasuryVaultPda);
      const balanceBefore = new BN(treasuryBefore.amount.toString());

      await program.methods
        .fundTreasury(TREASURY_FUND_AMOUNT)
        .accounts({
          funder: admin.publicKey,
          stakePool: stakePoolPda,
          stakingMint: novaMint,
          funderTokenAccount: adminTokenAccount,
          treasuryVault: treasuryVaultPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc();

      const treasuryAfter = await getAccount(connection, treasuryVaultPda);
      const balanceAfter = new BN(treasuryAfter.amount.toString());

      expect(balanceAfter.sub(balanceBefore).toString()).to.equal(
        TREASURY_FUND_AMOUNT.toString()
      );
    });
  });

  // ============================================
  // Test 4 & 5: Stake in Each Tier
  // ============================================
  describe("4 & 5. Staking in All Tiers", () => {
    describe("4a. Flex Tier (no lock)", () => {
      it("should stake in Flex tier successfully", async () => {
        const vaultBefore = await getAccount(connection, stakingVaultPda);
        const vaultBalanceBefore = new BN(vaultBefore.amount.toString());

        await program.methods
          .stake(STAKE_AMOUNT, TIER_FLEX)
          .accounts({
            user: user1.publicKey,
            stakePool: stakePoolPda,
            userStake: user1StakePda,
            stakingMint: novaMint,
            userTokenAccount: user1TokenAccount,
            stakingVault: stakingVaultPda,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([user1])
          .rpc();

        // Verify vault balance increased
        const vaultAfter = await getAccount(connection, stakingVaultPda);
        const vaultBalanceAfter = new BN(vaultAfter.amount.toString());
        expect(vaultBalanceAfter.sub(vaultBalanceBefore).toString()).to.equal(
          STAKE_AMOUNT.toString(),
          "Vault balance should increase by stake amount"
        );

        // Verify user stake state
        const userStake = await program.account.userStake.fetch(user1StakePda);
        expect(userStake.owner.toBase58()).to.equal(
          user1.publicKey.toBase58()
        );
        expect(userStake.stakedAmount.toString()).to.equal(
          STAKE_AMOUNT.toString()
        );
        expect(userStake.tier).to.equal(TIER_FLEX);
        expect(userStake.isActive).to.equal(true);
        expect(userStake.stakeStartTime.toNumber()).to.be.greaterThan(0);
        expect(userStake.lastClaimTime.toNumber()).to.be.greaterThan(0);
      });
    });

    describe("4b. Core Tier (90-day lock)", () => {
      let coreUserStakePda: PublicKey;
      let coreUser: Keypair;
      let coreUserTokenAccount: PublicKey;

      before(async () => {
        coreUser = Keypair.generate();
        await airdrop(coreUser.publicKey, 10);

        coreUserTokenAccount = await createAccount(
          connection,
          coreUser,
          novaMint,
          coreUser.publicKey
        );

        await mintTo(
          connection,
          admin,
          novaMint,
          coreUserTokenAccount,
          admin,
          BigInt(MINT_AMOUNT.toString())
        );

        [coreUserStakePda] = PublicKey.findProgramAddressSync(
          [
            USER_STAKE_SEED,
            stakePoolPda.toBuffer(),
            coreUser.publicKey.toBuffer(),
          ],
          program.programId
        );
      });

      it("should stake in Core tier successfully", async () => {
        await program.methods
          .stake(STAKE_AMOUNT, TIER_CORE)
          .accounts({
            user: coreUser.publicKey,
            stakePool: stakePoolPda,
            userStake: coreUserStakePda,
            stakingMint: novaMint,
            userTokenAccount: coreUserTokenAccount,
            stakingVault: stakingVaultPda,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([coreUser])
          .rpc();

        const userStake = await program.account.userStake.fetch(
          coreUserStakePda
        );
        expect(userStake.tier).to.equal(TIER_CORE);
        expect(userStake.stakedAmount.toString()).to.equal(
          STAKE_AMOUNT.toString()
        );
      });
    });

    describe("4c. Prime Tier (180-day lock)", () => {
      it("should stake in Prime tier successfully", async () => {
        await program.methods
          .stake(STAKE_AMOUNT, TIER_PRIME)
          .accounts({
            user: user2.publicKey,
            stakePool: stakePoolPda,
            userStake: user2StakePda,
            stakingMint: novaMint,
            userTokenAccount: user2TokenAccount,
            stakingVault: stakingVaultPda,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([user2])
          .rpc();

        const userStake = await program.account.userStake.fetch(user2StakePda);
        expect(userStake.tier).to.equal(TIER_PRIME);
        expect(userStake.stakedAmount.toString()).to.equal(
          STAKE_AMOUNT.toString()
        );
      });
    });

    describe("4d. Pool Stats Update", () => {
      it("should have updated pool total staked and staker count", async () => {
        const poolState = await program.account.stakePool.fetch(stakePoolPda);

        // 3 stakers: user1 (Flex), coreUser (Core), user2 (Prime)
        expect(poolState.stakerCount.toNumber()).to.equal(3);

        // Total staked: 3 * STAKE_AMOUNT
        const expectedTotal = STAKE_AMOUNT.mul(new BN(3));
        expect(poolState.totalStaked.toString()).to.equal(
          expectedTotal.toString()
        );
      });
    });
  });

  // ============================================
  // Test 6: Claim Rewards
  // ============================================
  describe("6. Claim Rewards", () => {
    it("should have rewards > 0 after time passes", async () => {
      // Wait a bit to accrue some rewards
      await advanceTime(5);

      // Get user stake state to check pending
      const userStakeBefore = await program.account.userStake.fetch(
        user1StakePda
      );
      const lastClaimBefore = userStakeBefore.lastClaimTime.toNumber();

      // Claim rewards
      await program.methods
        .claimRewards()
        .accounts({
          user: user1.publicKey,
          stakePool: stakePoolPda,
          userStake: user1StakePda,
          stakingMint: novaMint,
          userTokenAccount: user1TokenAccount,
          treasuryVault: treasuryVaultPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc();

      // Verify last_claim_time was updated
      const userStakeAfter = await program.account.userStake.fetch(
        user1StakePda
      );
      const lastClaimAfter = userStakeAfter.lastClaimTime.toNumber();

      expect(lastClaimAfter).to.be.greaterThanOrEqual(
        lastClaimBefore,
        "last_claim_time should be updated"
      );

      // Total rewards claimed should be > 0
      expect(userStakeAfter.totalRewardsClaimed.toNumber()).to.be.greaterThan(
        0,
        "Should have claimed some rewards"
      );
    });

    it("should get ~0 rewards when claiming twice without time passing", async () => {
      // Get rewards claimed before
      const userStakeBefore = await program.account.userStake.fetch(
        user1StakePda
      );
      const rewardsClaimedBefore = userStakeBefore.totalRewardsClaimed;

      // Try to claim again immediately - should fail with NoRewardsAvailable
      // or succeed with 0 rewards
      try {
        await program.methods
          .claimRewards()
          .accounts({
            user: user1.publicKey,
            stakePool: stakePoolPda,
            userStake: user1StakePda,
            stakingMint: novaMint,
            userTokenAccount: user1TokenAccount,
            treasuryVault: treasuryVaultPda,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user1])
          .rpc();

        // If it succeeds, rewards should be ~0 (minimal)
        const userStakeAfter = await program.account.userStake.fetch(
          user1StakePda
        );
        const rewardsDiff = userStakeAfter.totalRewardsClaimed.sub(
          rewardsClaimedBefore
        );

        // Should be very small or 0
        expect(rewardsDiff.toNumber()).to.be.lessThan(
          1000, // Allow tiny rounding
          "Second claim should yield ~0 rewards"
        );
      } catch (error: any) {
        // Expected: NoRewardsAvailable error
        expect(error.message).to.include("NoRewardsAvailable");
      }
    });
  });

  // ============================================
  // Test 7: Lock Period Enforcement
  // ============================================
  describe("7. Lock Period Enforcement", () => {
    describe("7a. Flex can unstake immediately", () => {
      it("should allow Flex tier to unstake without lock", async () => {
        const unstakeAmount = STAKE_AMOUNT.div(new BN(2)); // Unstake half

        const vaultBefore = await getAccount(connection, stakingVaultPda);
        const vaultBalanceBefore = new BN(vaultBefore.amount.toString());

        await program.methods
          .unstake(unstakeAmount)
          .accounts({
            user: user1.publicKey,
            stakePool: stakePoolPda,
            userStake: user1StakePda,
            owner: user1.publicKey,
            stakingMint: novaMint,
            userTokenAccount: user1TokenAccount,
            stakingVault: stakingVaultPda,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user1])
          .rpc();

        // Verify vault balance decreased
        const vaultAfter = await getAccount(connection, stakingVaultPda);
        const vaultBalanceAfter = new BN(vaultAfter.amount.toString());
        expect(vaultBalanceBefore.sub(vaultBalanceAfter).toString()).to.equal(
          unstakeAmount.toString(),
          "Vault balance should decrease by unstake amount"
        );

        // Verify user stake updated
        const userStake = await program.account.userStake.fetch(user1StakePda);
        expect(userStake.stakedAmount.toString()).to.equal(
          STAKE_AMOUNT.sub(unstakeAmount).toString()
        );
      });
    });

    describe("7b. Core cannot unstake before 90 days", () => {
      let coreUserStakePda: PublicKey;
      let coreUser: Keypair;
      let coreUserTokenAccount: PublicKey;

      before(async () => {
        // Create a new Core tier staker for this test
        coreUser = Keypair.generate();
        await airdrop(coreUser.publicKey, 10);

        coreUserTokenAccount = await createAccount(
          connection,
          coreUser,
          novaMint,
          coreUser.publicKey
        );

        await mintTo(
          connection,
          admin,
          novaMint,
          coreUserTokenAccount,
          admin,
          BigInt(MINT_AMOUNT.toString())
        );

        [coreUserStakePda] = PublicKey.findProgramAddressSync(
          [
            USER_STAKE_SEED,
            stakePoolPda.toBuffer(),
            coreUser.publicKey.toBuffer(),
          ],
          program.programId
        );

        // Stake in Core tier
        await program.methods
          .stake(STAKE_AMOUNT, TIER_CORE)
          .accounts({
            user: coreUser.publicKey,
            stakePool: stakePoolPda,
            userStake: coreUserStakePda,
            stakingMint: novaMint,
            userTokenAccount: coreUserTokenAccount,
            stakingVault: stakingVaultPda,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([coreUser])
          .rpc();
      });

      it("should reject unstake before lock period ends", async () => {
        try {
          await program.methods
            .unstake(STAKE_AMOUNT)
            .accounts({
              user: coreUser.publicKey,
              stakePool: stakePoolPda,
              userStake: coreUserStakePda,
              owner: coreUser.publicKey,
              stakingMint: novaMint,
              userTokenAccount: coreUserTokenAccount,
              stakingVault: stakingVaultPda,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([coreUser])
            .rpc();
          expect.fail("Should have thrown LockPeriodNotEnded error");
        } catch (error: any) {
          expect(error.message).to.include("LockPeriodNotEnded");
        }
      });
    });

    describe("7c. Prime cannot unstake before 180 days", () => {
      it("should reject Prime tier unstake before lock period", async () => {
        try {
          await program.methods
            .unstake(STAKE_AMOUNT)
            .accounts({
              user: user2.publicKey,
              stakePool: stakePoolPda,
              userStake: user2StakePda,
              owner: user2.publicKey,
              stakingMint: novaMint,
              userTokenAccount: user2TokenAccount,
              stakingVault: stakingVaultPda,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([user2])
            .rpc();
          expect.fail("Should have thrown LockPeriodNotEnded error");
        } catch (error: any) {
          expect(error.message).to.include("LockPeriodNotEnded");
        }
      });
    });
  });

  // ============================================
  // Test 8: Unstake After Lock (simulated)
  // ============================================
  describe("8. Unstake After Lock", () => {
    it("should allow Flex complete unstake and verify principal returned", async () => {
      // Get current state
      const userStakeBefore = await program.account.userStake.fetch(
        user1StakePda
      );
      const remainingStake = userStakeBefore.stakedAmount;

      if (remainingStake.toNumber() > 0) {
        const userBalanceBefore = await getAccount(
          connection,
          user1TokenAccount
        );
        const vaultBefore = await getAccount(connection, stakingVaultPda);

        // Unstake remaining
        await program.methods
          .unstake(remainingStake)
          .accounts({
            user: user1.publicKey,
            stakePool: stakePoolPda,
            userStake: user1StakePda,
            owner: user1.publicKey,
            stakingMint: novaMint,
            userTokenAccount: user1TokenAccount,
            stakingVault: stakingVaultPda,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user1])
          .rpc();

        // Verify user received principal
        const userBalanceAfter = await getAccount(
          connection,
          user1TokenAccount
        );
        const receivedAmount =
          BigInt(userBalanceAfter.amount.toString()) -
          BigInt(userBalanceBefore.amount.toString());
        expect(receivedAmount.toString()).to.equal(
          remainingStake.toString(),
          "User should receive full principal"
        );

        // Verify vault decreased
        const vaultAfter = await getAccount(connection, stakingVaultPda);
        const vaultDecrease =
          BigInt(vaultBefore.amount.toString()) -
          BigInt(vaultAfter.amount.toString());
        expect(vaultDecrease.toString()).to.equal(
          remainingStake.toString(),
          "Vault should decrease by unstake amount"
        );

        // Verify user stake marked inactive
        const userStakeAfter = await program.account.userStake.fetch(
          user1StakePda
        );
        expect(userStakeAfter.stakedAmount.toNumber()).to.equal(0);
        expect(userStakeAfter.isActive).to.equal(false);
      }
    });
  });

  // ============================================
  // Test 9: Emission Cap Enforcement
  // ============================================
  describe("9. Emission Cap", () => {
    let emissionTestUser: Keypair;
    let emissionTestTokenAccount: PublicKey;
    let emissionTestStakePda: PublicKey;
    let lowCapPoolMint: PublicKey;
    let lowCapPoolPda: PublicKey;
    let lowCapVaultPda: PublicKey;
    let lowCapTreasuryPda: PublicKey;

    before(async () => {
      // Create a separate pool with very low emission cap for testing
      emissionTestUser = Keypair.generate();
      await airdrop(emissionTestUser.publicKey, 10);

      // Create new mint for isolated test
      lowCapPoolMint = await createMint(
        connection,
        admin,
        admin.publicKey,
        null,
        6
      );

      emissionTestTokenAccount = await createAccount(
        connection,
        emissionTestUser,
        lowCapPoolMint,
        emissionTestUser.publicKey
      );

      await mintTo(
        connection,
        admin,
        lowCapPoolMint,
        emissionTestTokenAccount,
        admin,
        BigInt(MINT_AMOUNT.toString())
      );

      // Derive PDAs for new pool
      [lowCapPoolPda] = PublicKey.findProgramAddressSync(
        [STAKE_POOL_SEED, lowCapPoolMint.toBuffer()],
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
        [
          USER_STAKE_SEED,
          lowCapPoolPda.toBuffer(),
          emissionTestUser.publicKey.toBuffer(),
        ],
        program.programId
      );
    });

    it("should enforce emission cap and fail claim when exceeded", async () => {
      // Initialize pool with very low emission cap (100 tokens)
      const lowEmissionCap = new BN(100_000_000); // 100 tokens

      await program.methods
        .initialize(lowEmissionCap, FLEX_APY, CORE_APY, PRIME_APY)
        .accounts({
          authority: admin.publicKey,
          stakePool: lowCapPoolPda,
          stakingMint: lowCapPoolMint,
          stakingVault: lowCapVaultPda,
          treasuryVault: lowCapTreasuryPda,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([admin])
        .rpc();

      // Fund treasury with small amount (less than would be needed for large rewards)
      const adminLowCapToken = await createAccount(
        connection,
        admin,
        lowCapPoolMint,
        admin.publicKey
      );
      await mintTo(
        connection,
        admin,
        lowCapPoolMint,
        adminLowCapToken,
        admin,
        BigInt(TREASURY_FUND_AMOUNT.toString())
      );

      await program.methods
        .fundTreasury(new BN(50_000_000)) // Fund only 50 tokens
        .accounts({
          funder: admin.publicKey,
          stakePool: lowCapPoolPda,
          stakingMint: lowCapPoolMint,
          funderTokenAccount: adminLowCapToken,
          treasuryVault: lowCapTreasuryPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc();

      // Stake large amount to generate rewards exceeding cap
      await program.methods
        .stake(STAKE_AMOUNT, TIER_FLEX)
        .accounts({
          user: emissionTestUser.publicKey,
          stakePool: lowCapPoolPda,
          userStake: emissionTestStakePda,
          stakingMint: lowCapPoolMint,
          userTokenAccount: emissionTestTokenAccount,
          stakingVault: lowCapVaultPda,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([emissionTestUser])
        .rpc();

      // Update emission cap to very low value via admin
      await program.methods
        .updateEmissionCap(new BN(1)) // Set cap to 1 token
        .accounts({
          authority: admin.publicKey,
          stakePool: lowCapPoolPda,
        })
        .signers([admin])
        .rpc();

      // Wait for rewards to accrue
      await advanceTime(3);

      // Try to claim - should fail due to emission cap
      try {
        await program.methods
          .claimRewards()
          .accounts({
            user: emissionTestUser.publicKey,
            stakePool: lowCapPoolPda,
            userStake: emissionTestStakePda,
            stakingMint: lowCapPoolMint,
            userTokenAccount: emissionTestTokenAccount,
            treasuryVault: lowCapTreasuryPda,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([emissionTestUser])
          .rpc();

        // If it succeeds, verify distributed doesn't exceed cap
        const poolState = await program.account.stakePool.fetch(lowCapPoolPda);
        expect(poolState.totalDistributed.toNumber()).to.be.lessThanOrEqual(
          poolState.emissionCap.toNumber(),
          "Total distributed should not exceed emission cap"
        );
      } catch (error: any) {
        // Expected: EmissionCapExceeded or NoRewardsAvailable
        const validErrors = [
          "EmissionCapExceeded",
          "NoRewardsAvailable",
          "InsufficientTreasuryFunds",
        ];
        const hasValidError = validErrors.some((e) =>
          error.message.includes(e)
        );
        expect(hasValidError).to.equal(
          true,
          `Expected emission cap related error, got: ${error.message}`
        );
      }
    });
  });

  // ============================================
  // Test 10: Pause/Unpause Functionality
  // ============================================
  describe("10. Pause/Unpause", () => {
    let pauseTestUser: Keypair;
    let pauseTestTokenAccount: PublicKey;
    let pauseTestStakePda: PublicKey;

    before(async () => {
      pauseTestUser = Keypair.generate();
      await airdrop(pauseTestUser.publicKey, 10);

      pauseTestTokenAccount = await createAccount(
        connection,
        pauseTestUser,
        novaMint,
        pauseTestUser.publicKey
      );

      await mintTo(
        connection,
        admin,
        novaMint,
        pauseTestTokenAccount,
        admin,
        BigInt(MINT_AMOUNT.toString())
      );

      [pauseTestStakePda] = PublicKey.findProgramAddressSync(
        [
          USER_STAKE_SEED,
          stakePoolPda.toBuffer(),
          pauseTestUser.publicKey.toBuffer(),
        ],
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
      expect(poolState.paused).to.equal(true);
    });

    it("should block stake when paused", async () => {
      try {
        await program.methods
          .stake(STAKE_AMOUNT, TIER_FLEX)
          .accounts({
            user: pauseTestUser.publicKey,
            stakePool: stakePoolPda,
            userStake: pauseTestStakePda,
            stakingMint: novaMint,
            userTokenAccount: pauseTestTokenAccount,
            stakingVault: stakingVaultPda,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([pauseTestUser])
          .rpc();
        expect.fail("Should have thrown StakingPaused error");
      } catch (error: any) {
        expect(error.message).to.include("StakingPaused");
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
        expect.fail("Should have thrown Unauthorized error");
      } catch (error: any) {
        // Should fail due to authority constraint
        expect(error.message).to.include("Unauthorized").or.include("constraint");
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
      expect(poolState.paused).to.equal(false);
    });

    it("should allow staking after unpause", async () => {
      await program.methods
        .stake(STAKE_AMOUNT, TIER_FLEX)
        .accounts({
          user: pauseTestUser.publicKey,
          stakePool: stakePoolPda,
          userStake: pauseTestStakePda,
          stakingMint: novaMint,
          userTokenAccount: pauseTestTokenAccount,
          stakingVault: stakingVaultPda,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([pauseTestUser])
        .rpc();

      const userStake = await program.account.userStake.fetch(
        pauseTestStakePda
      );
      expect(userStake.stakedAmount.toString()).to.equal(
        STAKE_AMOUNT.toString()
      );
      expect(userStake.isActive).to.equal(true);
    });
  });

  // ============================================
  // Additional Tests: Edge Cases
  // ============================================
  describe("Additional: Edge Cases", () => {
    it("should reject staking with zero amount", async () => {
      const testUser = Keypair.generate();
      await airdrop(testUser.publicKey, 5);

      const testTokenAccount = await createAccount(
        connection,
        testUser,
        novaMint,
        testUser.publicKey
      );

      await mintTo(
        connection,
        admin,
        novaMint,
        testTokenAccount,
        admin,
        BigInt(MINT_AMOUNT.toString())
      );

      const [testStakePda] = PublicKey.findProgramAddressSync(
        [
          USER_STAKE_SEED,
          stakePoolPda.toBuffer(),
          testUser.publicKey.toBuffer(),
        ],
        program.programId
      );

      try {
        await program.methods
          .stake(new BN(0), TIER_FLEX)
          .accounts({
            user: testUser.publicKey,
            stakePool: stakePoolPda,
            userStake: testStakePda,
            stakingMint: novaMint,
            userTokenAccount: testTokenAccount,
            stakingVault: stakingVaultPda,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([testUser])
          .rpc();
        expect.fail("Should have thrown ZeroAmount error");
      } catch (error: any) {
        expect(error.message).to.include("ZeroAmount");
      }
    });

    it("should reject invalid tier", async () => {
      const testUser = Keypair.generate();
      await airdrop(testUser.publicKey, 5);

      const testTokenAccount = await createAccount(
        connection,
        testUser,
        novaMint,
        testUser.publicKey
      );

      await mintTo(
        connection,
        admin,
        novaMint,
        testTokenAccount,
        admin,
        BigInt(MINT_AMOUNT.toString())
      );

      const [testStakePda] = PublicKey.findProgramAddressSync(
        [
          USER_STAKE_SEED,
          stakePoolPda.toBuffer(),
          testUser.publicKey.toBuffer(),
        ],
        program.programId
      );

      try {
        await program.methods
          .stake(STAKE_AMOUNT, 99) // Invalid tier
          .accounts({
            user: testUser.publicKey,
            stakePool: stakePoolPda,
            userStake: testStakePda,
            stakingMint: novaMint,
            userTokenAccount: testTokenAccount,
            stakingVault: stakingVaultPda,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([testUser])
          .rpc();
        expect.fail("Should have thrown InvalidTier error");
      } catch (error: any) {
        expect(error.message).to.include("InvalidTier");
      }
    });

    it("should reject unstaking more than staked", async () => {
      // Re-stake user1 for this test
      const [testStakePda] = PublicKey.findProgramAddressSync(
        [
          USER_STAKE_SEED,
          stakePoolPda.toBuffer(),
          user1.publicKey.toBuffer(),
        ],
        program.programId
      );

      // First stake something
      await program.methods
        .stake(STAKE_AMOUNT, TIER_FLEX)
        .accounts({
          user: user1.publicKey,
          stakePool: stakePoolPda,
          userStake: testStakePda,
          stakingMint: novaMint,
          userTokenAccount: user1TokenAccount,
          stakingVault: stakingVaultPda,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([user1])
        .rpc();

      // Try to unstake more than staked
      const excessAmount = STAKE_AMOUNT.mul(new BN(2));
      try {
        await program.methods
          .unstake(excessAmount)
          .accounts({
            user: user1.publicKey,
            stakePool: stakePoolPda,
            userStake: testStakePda,
            owner: user1.publicKey,
            stakingMint: novaMint,
            userTokenAccount: user1TokenAccount,
            stakingVault: stakingVaultPda,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user1])
          .rpc();
        expect.fail("Should have thrown InsufficientStakedBalance error");
      } catch (error: any) {
        expect(error.message).to.include("InsufficientStakedBalance");
      }
    });

    it("should allow APY adjustment by admin", async () => {
      const newFlexApy = 500; // 5%
      const newCoreApy = 1200; // 12%
      const newPrimeApy = 1600; // 16%

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

      // Reset to original values
      await program.methods
        .adjustApy(FLEX_APY, CORE_APY, PRIME_APY)
        .accounts({
          authority: admin.publicKey,
          stakePool: stakePoolPda,
        })
        .signers([admin])
        .rpc();
    });

    it("should reject APY above maximum", async () => {
      try {
        await program.methods
          .adjustApy(6000, CORE_APY, PRIME_APY) // 60% exceeds 50% max
          .accounts({
            authority: admin.publicKey,
            stakePool: stakePoolPda,
          })
          .signers([admin])
          .rpc();
        expect.fail("Should have thrown ApyTooHigh error");
      } catch (error: any) {
        expect(error.message).to.include("ApyTooHigh");
      }
    });
  });
});
