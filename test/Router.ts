import {expect} from "chai";
import {ethers, network} from "hardhat";
import {utils} from "ethers";
import {time, loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {Token, Vault, WETH, Router} from "../typechain-types";
import {parseEther} from "ethers/lib/utils";
import {getTariffHash, toAmountUint256, toYieldUint256} from "./helpers/format";
import * as data from "./helpers/data";
import {getPermit} from "./helpers/permit";

describe("router", () => {
  async function deploy() {
    const [, user, mpc, receiver] = await ethers.getSigners();

    // eslint-disable-next-line @typescript-eslint/no-shadow
    const Token = await ethers.getContractFactory("Token");
    const btcb = await Token.deploy("BTCB Token", "BTCB", 18);
    const usdt = await Token.deploy("Tether USD", "USDT", 6);

    // eslint-disable-next-line @typescript-eslint/no-shadow
    const WETH = await ethers.getContractFactory("WETH");
    const weth = await WETH.deploy();

    // eslint-disable-next-line @typescript-eslint/no-shadow
    const Vault = await ethers.getContractFactory("Vault");
    const vault = await Vault.deploy(weth.address, mpc.address);

    // eslint-disable-next-line @typescript-eslint/no-shadow
    const Router = await ethers.getContractFactory("Router");
    const router = await Router.deploy(vault.address, weth.address, mpc.address);

    await vault.connect(mpc).initOperators([router.address]);

    return {
      btcb: btcb as Token,
      usdt: usdt as Token,
      weth: weth as WETH,

      router: router as Router,
      vault: vault as Vault,

      user,
      mpc,
      receiver,
    };
  }

  before(async () => {
    await network.provider.request({
      method: "hardhat_reset",
    });
  });

  describe("updateMPC()", () => {
    it("should update mpc", async () => {
      const {router, mpc} = await loadFixture(deploy);

      const tx = await router.connect(mpc).updateMPC("0x1f7b0df2a23e5f98807cb5282017de7be67caddf");
      const now = await time.latest();
      const {status, events} = await tx.wait();
      const event = events?.[0] as any;

      const mpc1 = await router.mpc();
      await time.increase(48 * 60 * 60);
      const mpc2 = await router.mpc();

      expect(status).eq(1);
      expect(events).length(1);

      expect(event.event).eq("MPCUpdated");
      expect(event.args).length(3);
      expect(event.args[0]).eq(mpc.address);
      expect(event.args[1].toLowerCase()).eq("0x1f7b0df2a23e5f98807cb5282017de7be67caddf");
      expect(event.args[2].toNumber()).eq(now + 48 * 60 * 60);

      expect(mpc1).eq(mpc.address);
      expect(mpc2.toLowerCase()).eq("0x1f7b0df2a23e5f98807cb5282017de7be67caddf");
    });

    it("should not update mpc if not mpc", async () => {
      const {router, user} = await loadFixture(deploy);

      const tx = router.connect(user).updateMPC("0x1f7b0df2a23e5f98807cb5282017de7be67caddf");

      await expect(tx).to.be.revertedWith("MPCManageable: Non MPC");
    });

    it("should not update mpc to zero address", async () => {
      const {router, mpc} = await loadFixture(deploy);

      const tx = router.connect(mpc).updateMPC(ethers.constants.AddressZero);

      await expect(tx).to.be.revertedWith("MPCManageable: Nullable MPC");
    });
  });

  describe("updateVault()", () => {
    it("should update vault", async () => {
      const {router, vault, mpc} = await loadFixture(deploy);

      const vaultBefore = await router.vault();

      const tx = await router.connect(mpc).updateVault(mpc.address);
      const {status, events} = await tx.wait();
      const event = events?.[0] as any;

      const vaultAfter = await router.vault();

      expect(status).eq(1);
      expect(events).length(1);

      expect(event.event).eq("VaultUpdated");
      expect(event.args).length(2);
      expect(event.args[0]).eq(vault.address);
      expect(event.args[1]).eq(mpc.address);

      expect(vaultBefore).eq(vault.address);
      expect(vaultAfter).eq(mpc.address);
    });

    it("should not update vault if not mpc", async () => {
      const {router, user} = await loadFixture(deploy);

      const vaultBefore = await router.vault();
      const tx = router.connect(user).updateVault(user.address);

      await expect(tx).to.be.revertedWith("MPCManageable: Non MPC");

      const vaultAfter = await router.vault();

      expect(vaultBefore).eq(vaultAfter);
    });

    it("should not update vault to zero address", async () => {
      const {router, mpc} = await loadFixture(deploy);

      const vaultBefore = await router.vault();
      const tx = router.connect(mpc).updateVault(ethers.constants.AddressZero);

      await expect(tx).to.be.revertedWith("Router: Bad address");

      const vaultAfter = await router.vault();

      expect(vaultBefore).eq(vaultAfter);
    });
  });

  describe("pause()", () => {
    it("should pause", async () => {
      const {router, mpc} = await loadFixture(deploy);

      const pausedBefore = await router.paused();

      const tx = await router.connect(mpc).pause();
      const {status, events} = await tx.wait();
      const event = events?.[0] as any;

      const pausedAfter = await router.paused();

      expect(status).eq(1);
      expect(events).length(1);

      expect(event.event).eq("Paused");
      expect(event.args).length(1);
      expect(event.args[0]).eq(mpc.address);

      expect(pausedBefore).eq(false);
      expect(pausedAfter).eq(true);
    });

    it("should not pause if not mpc", async () => {
      const {router, user} = await loadFixture(deploy);

      const pausedBefore = await router.paused();
      const tx = router.connect(user).pause();

      await expect(tx).to.be.revertedWith("MPCManageable: Non MPC");

      const pausedAfter = await router.paused();

      expect(pausedBefore).eq(false);
      expect(pausedAfter).eq(false);
    });

    it("should not pause if paused", async () => {
      const {router, mpc} = await loadFixture(deploy);

      await router.connect(mpc).pause();

      const pausedBefore = await router.paused();
      const tx = router.connect(mpc).pause();

      await expect(tx).to.be.revertedWith("Pausable: paused");

      const pausedAfter = await router.paused();

      expect(pausedBefore).eq(true);
      expect(pausedAfter).eq(true);
    });
  });

  describe("unpause()", () => {
    it("should unpause", async () => {
      const {router, mpc} = await loadFixture(deploy);

      await router.connect(mpc).pause();

      const pausedBefore = await router.paused();

      const tx = await router.connect(mpc).unpause();
      const {status, events} = await tx.wait();
      const event = events?.[0] as any;

      const pausedAfter = await router.paused();

      expect(status).eq(1);
      expect(events).length(1);

      expect(event.event).eq("Unpaused");
      expect(event.args).length(1);
      expect(event.args[0]).eq(mpc.address);

      expect(pausedBefore).eq(true);
      expect(pausedAfter).eq(false);
    });

    it("should unpause if not mpc", async () => {
      const {router, mpc, user} = await loadFixture(deploy);

      await router.connect(mpc).pause();

      const pausedBefore = await router.paused();
      const tx = router.connect(user).unpause();

      await expect(tx).to.be.revertedWith("MPCManageable: Non MPC");

      const pausedAfter = await router.paused();

      expect(pausedBefore).eq(true);
      expect(pausedAfter).eq(true);
    });

    it("should not unpause if unpaused", async () => {
      const {router, mpc} = await loadFixture(deploy);

      const pausedBefore = await router.paused();
      const tx = router.connect(mpc).unpause();

      await expect(tx).to.be.revertedWith("Pausable: not paused");

      const pausedAfter = await router.paused();

      expect(pausedBefore).eq(false);
      expect(pausedAfter).eq(false);
    });
  });

  describe("create()", () => {
    it("should create", async () => {
      const state = await loadFixture(deploy);
      const {router, vault, user, mpc, usdt} = state;

      // top up user to be sure here's enough funds to withdraw
      await usdt.transfer(user.address, 100 * 1e6);
      await usdt.connect(user).approve(vault.address, 100 * 1e6);

      const userBalanceBefore = await usdt.balanceOf(user.address);
      const vaultBalanceBefore = await usdt.balanceOf(vault.address);

      const tariff = data.router.tariff(state) as any;
      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = await router.connect(user).create(
        tariff,
        {
          user: user.address,
          token: usdt.address,
          amount: 60 * 1e6,
        },
        signature,
      );

      const {status, events} = await tx.wait();
      const event1 = events?.[0] as any;
      const event2 = events?.[1] as any;
      const event3 = events?.[2] as any;

      const userBalanceAfter = await usdt.balanceOf(user.address);
      const vaultBalanceAfter = await usdt.balanceOf(vault.address);

      expect(status).eq(1);
      expect(events).length(3);

      expect(event1.address).to.be.equal(usdt.address);
      expect(event1.topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Approval(address,address,uint256)")),
        user.address,
        vault.address,
      ]);
      expect(parseInt(event1.data, 16)).to.be.equal(40 * 1e6);

      expect(event2.address).to.be.equal(usdt.address);
      expect(event2.topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Transfer(address,address,uint256)")),
        user.address,
        vault.address,
      ]);
      expect(parseInt(event2.data, 16)).to.be.equal(60 * 1e6);

      expect(event3.event).eq("DualCreated");
      expect(event3.args).length(8);
      expect(event3.args[0]).eq(user.address);
      expect(event3.args[1]).eq(network.config.chainId);
      expect(event3.args[2]).eq(tariff.baseToken);
      expect(event3.args[3]).eq(tariff.quoteToken);
      expect(event3.args[4]).eq(usdt.address);
      expect(event3.args[5]).eq(60 * 1e6);
      expect(event3.args[6]).eq(tariff.stakingPeriod);
      expect(event3.args[7]).eq(tariff.yield);

      expect(userBalanceBefore).eq(100 * 1e6);
      expect(userBalanceAfter).eq(40 * 1e6);

      expect(vaultBalanceBefore).eq(0);
      expect(vaultBalanceAfter).eq(60 * 1e6);
    });

    it("should create by mpc", async () => {
      const state = await loadFixture(deploy);
      const {router, vault, user, mpc, usdt} = state;

      // top up user to be sure here's enough funds to withdraw
      await usdt.transfer(user.address, 100 * 1e6);
      await usdt.connect(user).approve(vault.address, 100 * 1e6);

      const userBalanceBefore = await usdt.balanceOf(user.address);
      const vaultBalanceBefore = await usdt.balanceOf(vault.address);

      const tariff = data.router.tariff(state) as any;
      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = await router.connect(mpc).create(
        tariff,
        {
          user: user.address,
          token: usdt.address,
          amount: 60 * 1e6,
        },
        signature,
      );

      const {status, events} = await tx.wait();
      const event1 = events?.[0] as any;
      const event2 = events?.[1] as any;
      const event3 = events?.[2] as any;

      const userBalanceAfter = await usdt.balanceOf(user.address);
      const vaultBalanceAfter = await usdt.balanceOf(vault.address);

      expect(status).eq(1);
      expect(events).length(3);

      expect(event1.address).to.be.equal(usdt.address);
      expect(event1.topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Approval(address,address,uint256)")),
        user.address,
        vault.address,
      ]);
      expect(parseInt(event1.data, 16)).to.be.equal(40 * 1e6);

      expect(event2.address).to.be.equal(usdt.address);
      expect(event2.topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Transfer(address,address,uint256)")),
        user.address,
        vault.address,
      ]);
      expect(parseInt(event2.data, 16)).to.be.equal(60 * 1e6);

      expect(event3.event).eq("DualCreated");
      expect(event3.args).length(8);
      expect(event3.args[0]).eq(user.address);
      expect(event3.args[1]).eq(network.config.chainId);
      expect(event3.args[2]).eq(tariff.baseToken);
      expect(event3.args[3]).eq(tariff.quoteToken);
      expect(event3.args[4]).eq(usdt.address);
      expect(event3.args[5]).eq(60 * 1e6);
      expect(event3.args[6]).eq(tariff.stakingPeriod);
      expect(event3.args[7]).eq(tariff.yield);

      expect(userBalanceBefore).eq(100 * 1e6);
      expect(userBalanceAfter).eq(40 * 1e6);

      expect(vaultBalanceBefore).eq(0);
      expect(vaultBalanceAfter).eq(60 * 1e6);
    });

    it("should create w/ custom tariff", async () => {
      const state = await loadFixture(deploy);
      const {router, vault, user, receiver, mpc, btcb} = state;

      // top up user to be sure here's enough funds to withdraw
      await btcb.transfer(user.address, toAmountUint256(1));
      await btcb.connect(user).approve(vault.address, toAmountUint256(100));

      const userBalanceBefore = await btcb.balanceOf(user.address);
      const vaultBalanceBefore = await btcb.balanceOf(vault.address);

      const tariff = {
        ...data.router.tariff(state),
        user: user.address,
      } as any;

      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx1 = await router.connect(user).create(
        tariff,
        {
          user: user.address,
          token: btcb.address,
          amount: toAmountUint256(0.2),
        },
        signature,
      );

      const tx2 = router.connect(receiver).create(
        tariff,
        {
          user: receiver.address,
          token: btcb.address,
          amount: toAmountUint256(0.2),
        },
        signature,
      );

      await expect(tx2).to.be.revertedWith("Router: Bad tariff user");

      const {status, events} = await tx1.wait();
      const event1 = events?.[0] as any;
      const event2 = events?.[1] as any;
      const event3 = events?.[2] as any;

      const userBalanceAfter = await btcb.balanceOf(user.address);
      const vaultBalanceAfter = await btcb.balanceOf(vault.address);

      expect(status).eq(1);
      expect(events).length(3);

      expect(event1.address).to.be.equal(btcb.address);
      expect(event1.topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Approval(address,address,uint256)")),
        user.address,
        vault.address,
      ]);
      expect(parseInt(event1.data, 16).toString()).to.be.equal(toAmountUint256(99.8));

      expect(event2.address).to.be.equal(btcb.address);
      expect(event2.topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Transfer(address,address,uint256)")),
        user.address,
        vault.address,
      ]);
      expect(parseInt(event2.data, 16).toString()).to.be.equal(toAmountUint256(0.2));

      expect(event3.event).eq("DualCreated");
      expect(event3.args).length(8);
      expect(event3.args[0]).eq(user.address);
      expect(event3.args[1]).eq(network.config.chainId);
      expect(event3.args[2]).eq(tariff.baseToken);
      expect(event3.args[3]).eq(tariff.quoteToken);
      expect(event3.args[4]).eq(btcb.address);
      expect(event3.args[5]).eq(toAmountUint256(0.2));
      expect(event3.args[6]).eq(tariff.stakingPeriod);
      expect(event3.args[7]).eq(tariff.yield);

      expect(userBalanceBefore).eq(toAmountUint256(1));
      expect(userBalanceAfter).eq(toAmountUint256(0.8));

      expect(vaultBalanceBefore).eq(0);
      expect(vaultBalanceAfter).eq(toAmountUint256(0.2));
    });

    it("should create w/ base threshold balancing", async () => {
      const state = await loadFixture(deploy);
      const {router, vault, user, mpc, btcb} = state;

      // top up user to be sure here's enough funds to withdraw
      await btcb.transfer(user.address, toAmountUint256(100));
      await btcb.connect(user).approve(vault.address, toAmountUint256(100));

      const userBalanceBefore = await btcb.balanceOf(user.address);
      const vaultBalanceBefore = await btcb.balanceOf(vault.address);
      const mpcBalanceBefore = await btcb.balanceOf(mpc.address);

      const tariff = data.router.tariff(state) as any;
      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = await router.connect(user).create(
        tariff,
        {
          user: user.address,
          token: btcb.address,
          amount: toAmountUint256(3),
        },
        signature,
      );

      const {status, events} = await tx.wait();
      const event1 = events?.[0] as any;
      const event2 = events?.[1] as any;
      const event3 = events?.[2] as any;

      const userBalanceAfter = await btcb.balanceOf(user.address);
      const vaultBalanceAfter = await btcb.balanceOf(vault.address);
      const mpcBalanceAfter = await btcb.balanceOf(mpc.address);

      expect(status).eq(1);
      expect(events).length(3);

      expect(event1.address).to.be.equal(btcb.address);
      expect(event1.topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Approval(address,address,uint256)")),
        user.address,
        vault.address,
      ]);
      expect(parseInt(event1.data, 16).toString()).to.be.equal(toAmountUint256(97));

      expect(event2.address).to.be.equal(btcb.address);
      expect(event2.topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Transfer(address,address,uint256)")),
        user.address,
        mpc.address,
      ]);
      expect(parseInt(event2.data, 16).toString()).to.be.equal(toAmountUint256(3));

      expect(event3.event).eq("DualCreated");
      expect(event3.args).length(8);
      expect(event3.args[0]).eq(user.address);
      expect(event3.args[1]).eq(network.config.chainId);
      expect(event3.args[2]).eq(tariff.baseToken);
      expect(event3.args[3]).eq(tariff.quoteToken);
      expect(event3.args[4]).eq(btcb.address);
      expect(event3.args[5]).eq(toAmountUint256(3));
      expect(event3.args[6]).eq(tariff.stakingPeriod);
      expect(event3.args[7]).eq(tariff.yield);

      expect(userBalanceBefore).eq(toAmountUint256(100));
      expect(userBalanceAfter).eq(toAmountUint256(97));

      expect(vaultBalanceBefore).eq(0);
      expect(vaultBalanceAfter).eq(0);

      expect(mpcBalanceBefore).eq(0);
      expect(mpcBalanceAfter).eq(toAmountUint256(3));
    });

    it("should create w/ quote threshold balancing", async () => {
      const state = await loadFixture(deploy);
      const {router, vault, user, mpc, usdt} = state;

      // top up user to be sure here's enough funds to withdraw
      await usdt.transfer(user.address, 10_000 * 1e6);
      await usdt.connect(user).approve(vault.address, 10_000 * 1e6);

      const userBalanceBefore = await usdt.balanceOf(user.address);
      const vaultBalanceBefore = await usdt.balanceOf(vault.address);
      const mpcBalanceBefore = await usdt.balanceOf(mpc.address);

      const tariff = data.router.tariff(state) as any;
      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = await router.connect(user).create(
        tariff,
        {
          user: user.address,
          token: usdt.address,
          amount: 6000 * 1e6,
        },
        signature,
      );

      const {status, events} = await tx.wait();
      const event1 = events?.[0] as any;
      const event2 = events?.[1] as any;
      const event3 = events?.[2] as any;

      const userBalanceAfter = await usdt.balanceOf(user.address);
      const vaultBalanceAfter = await usdt.balanceOf(vault.address);
      const mpcBalanceAfter = await usdt.balanceOf(mpc.address);

      expect(status).eq(1);
      expect(events).length(3);

      expect(event1.address).to.be.equal(usdt.address);
      expect(event1.topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Approval(address,address,uint256)")),
        user.address,
        vault.address,
      ]);
      expect(parseInt(event1.data, 16)).to.be.equal(4000 * 1e6);

      expect(event2.address).to.be.equal(usdt.address);
      expect(event2.topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Transfer(address,address,uint256)")),
        user.address,
        mpc.address,
      ]);
      expect(parseInt(event2.data, 16)).to.be.equal(6000 * 1e6);

      expect(event3.event).eq("DualCreated");
      expect(event3.args).length(8);
      expect(event3.args[0]).eq(user.address);
      expect(event3.args[1]).eq(network.config.chainId);
      expect(event3.args[2]).eq(tariff.baseToken);
      expect(event3.args[3]).eq(tariff.quoteToken);
      expect(event3.args[4]).eq(usdt.address);
      expect(event3.args[5]).eq(6000 * 1e6);
      expect(event3.args[6]).eq(tariff.stakingPeriod);
      expect(event3.args[7]).eq(tariff.yield);

      expect(userBalanceBefore).eq(10_000 * 1e6);
      expect(userBalanceAfter).eq(4000 * 1e6);

      expect(vaultBalanceBefore).eq(0);
      expect(vaultBalanceAfter).eq(0);

      expect(mpcBalanceBefore).eq(0);
      expect(mpcBalanceAfter).eq(6000 * 1e6);
    });

    it("should not create for another user", async () => {
      const state = await loadFixture(deploy);
      const {router, user, receiver, mpc, usdt} = state;

      const tariff = data.router.tariff(state) as any;
      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = router.connect(user).create(
        tariff,
        {
          user: receiver.address,
          token: usdt.address,
          amount: 100 * 1e6,
        },
        signature,
      );

      await expect(tx).to.be.revertedWith("Router: Access denied");
    });

    it("should not create w/ bad input user", async () => {
      const state = await loadFixture(deploy);
      const {router, user, mpc, usdt} = state;

      const tariff = data.router.tariff(state) as any;
      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = router.connect(user).create(
        tariff,
        {
          user: ethers.constants.AddressZero,
          token: usdt.address,
          amount: 100 * 1e6,
        },
        signature,
      );

      await expect(tx).to.be.revertedWith("Router: Bad user");
    });

    it("should not create w/ bad tariff chain id", async () => {
      const state = await loadFixture(deploy);
      const {router, user, mpc, usdt} = state;

      const tariff = {...data.router.tariff(state), chainId: 1} as any;
      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = router.connect(user).create(
        tariff,
        {
          user: user.address,
          token: usdt.address,
          amount: 100 * 1e6,
        },
        signature,
      );

      await expect(tx).to.be.revertedWith("MPCSignable: Must be MPC");
    });

    it("should not create w/ expired tariff", async () => {
      const state = await loadFixture(deploy);
      const {router, user, mpc, usdt} = state;

      const tariff = {
        ...data.router.tariff(state),
        expireAt: Math.round(Date.now() / 1000 - 60).toString(),
      } as any;

      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = router.connect(user).create(
        tariff,
        {
          user: user.address,
          token: usdt.address,
          amount: 100 * 1e6,
        },
        signature,
      );

      await expect(tx).to.be.revertedWith("Router: Tariff expired");
    });

    it("should not create w/ bad tariff user", async () => {
      const state = await loadFixture(deploy);
      const {router, user, mpc, usdt} = state;

      const tariff = {
        ...data.router.tariff(state),
        user: mpc.address,
      } as any;

      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = router.connect(user).create(
        tariff,
        {
          user: user.address,
          token: usdt.address,
          amount: 100 * 1e6,
        },
        signature,
      );

      await expect(tx).to.be.revertedWith("Router: Bad tariff user");
    });

    it("should not create w/ bad yield", async () => {
      const state = await loadFixture(deploy);
      const {router, user, mpc, usdt} = state;

      const tariff = {
        ...data.router.tariff(state),
        yield: 0,
      } as any;

      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = router.connect(user).create(
        tariff,
        {
          user: user.address,
          token: usdt.address,
          amount: 100 * 1e6,
        },
        signature,
      );

      await expect(tx).to.be.revertedWith("Router: Bad tariff yield");
    });

    it("should not create w/ bad stakingPeriod", async () => {
      const state = await loadFixture(deploy);
      const {router, user, mpc, usdt} = state;

      const tariff = {
        ...data.router.tariff(state),
        stakingPeriod: 0,
      } as any;

      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = router.connect(user).create(
        tariff,
        {
          user: user.address,
          token: usdt.address,
          amount: 100 * 1e6,
        },
        signature,
      );

      await expect(tx).to.be.revertedWith("Router: Bad tariff staking period");
    });

    it("should not create w/ bad inputToken", async () => {
      const state = await loadFixture(deploy);
      const {router, user, mpc} = state;

      const tariff = data.router.tariff(state) as any;
      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = router.connect(user).create(
        tariff,
        {
          user: user.address,
          token: ethers.constants.AddressZero,
          amount: 100 * 1e6,
        },
        signature,
      );

      await expect(tx).to.be.revertedWith("Router: Input must be one from pair");
    });

    it("should not create w/ bad signature", async () => {
      const state = await loadFixture(deploy);
      const {router, user, mpc, usdt} = state;

      const input = {
        user: user.address,
        token: usdt.address,
        amount: 100 * 1e6,
      };

      const tariff = data.router.tariff(state) as any;

      const signature1 = await mpc.signMessage(getTariffHash(tariff));
      const signature2 = await user.signMessage(getTariffHash(tariff));

      const tx1 = router.connect(user).create(
        {
          ...tariff,
          yield: toYieldUint256(0.1),
        },
        input,
        signature1,
      );

      const tx2 = router.connect(user).create(tariff, input, signature2);

      await expect(tx1).to.be.revertedWith("MPCSignable: Must be MPC");
      await expect(tx2).to.be.revertedWith("MPCSignable: Must be MPC");
    });

    it("should not create if input is less than minBaseAmount", async () => {
      const state = await loadFixture(deploy);
      const {router, user, mpc, btcb} = state;

      const tariff = data.router.tariff(state) as any;
      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = router.connect(user).create(
        tariff,
        {
          user: user.address,
          token: btcb.address,
          amount: toAmountUint256(0.01),
        },
        signature,
      );

      await expect(tx).revertedWith("Router: Too small input amount");
    });

    it("should not create if input is greater than maxBaseAmount", async () => {
      const state = await loadFixture(deploy);
      const {router, user, mpc, btcb} = state;

      const tariff = data.router.tariff(state) as any;
      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = router.connect(user).create(
        tariff,
        {
          user: user.address,
          token: btcb.address,
          amount: toAmountUint256(200),
        },
        signature,
      );

      await expect(tx).revertedWith("Router: Exceeds maximum input amount");
    });

    it("should not create if input is less than minQuoteAmount", async () => {
      const state = await loadFixture(deploy);
      const {router, user, mpc, usdt} = state;

      const tariff = data.router.tariff(state) as any;
      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = router.connect(user).create(
        tariff,
        {
          user: user.address,
          token: usdt.address,
          amount: 10 * 1e6,
        },
        signature,
      );

      await expect(tx).revertedWith("Router: Too small input amount");
    });

    it("should not create if input is greater than maxQuoteAmount", async () => {
      const state = await loadFixture(deploy);
      const {router, user, mpc, usdt} = state;

      const tariff = data.router.tariff(state) as any;
      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = router.connect(user).create(
        tariff,
        {
          user: user.address,
          token: usdt.address,
          amount: 50_000 * 1e6,
        },
        signature,
      );

      await expect(tx).revertedWith("Router: Exceeds maximum input amount");
    });

    it("should not create if has not enough funds", async () => {
      const state = await loadFixture(deploy);
      const {router, vault, user, mpc, usdt} = state;

      // top up user to be sure here's enough funds to withdraw
      await usdt.transfer(user.address, 100 * 1e6);
      await usdt.connect(user).approve(vault.address, 1000 * 1e6);

      const tariff = data.router.tariff(state) as any;
      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = router.connect(user).create(
        tariff,
        {
          user: user.address,
          token: usdt.address,
          amount: 200 * 1e6,
        },
        signature,
      );

      await expect(tx).to.be.revertedWith("ERC20: transfer amount exceeds balance");
    });

    it("should not create if has not enough allowance", async () => {
      const state = await loadFixture(deploy);
      const {router, vault, user, mpc, usdt} = state;

      // top up user to be sure here's enough funds to withdraw
      await usdt.transfer(user.address, 1000 * 1e6);
      await usdt.connect(user).approve(vault.address, 100 * 1e6);

      const tariff = data.router.tariff(state) as any;
      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = router.connect(user).create(
        tariff,
        {
          user: user.address,
          token: usdt.address,
          amount: 200 * 1e6,
        },
        signature,
      );

      await expect(tx).to.be.revertedWith("ERC20: insufficient allowance");
    });

    it("should not create if paused", async () => {
      const state = await loadFixture(deploy);
      const {router, user, mpc, usdt} = state;

      await router.connect(mpc).pause();

      const tariff = data.router.tariff(state) as any;
      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = router.connect(user).create(
        tariff,
        {
          user: user.address,
          token: usdt.address,
          amount: 300 * 1e6,
        },
        signature,
      );

      await expect(tx).revertedWith("Pausable: paused");
    });
  });

  describe("createWithPermit()", () => {
    it("should create with permit", async () => {
      const state = await loadFixture(deploy);
      const {router, vault, user, mpc, usdt} = state;

      // top up user to be sure here's enough funds to withdraw
      await usdt.transfer(user.address, 100 * 1e6);

      const userBalanceBefore = await usdt.balanceOf(user.address);
      const vaultBalanceBefore = await usdt.balanceOf(vault.address);

      const now = await time.latest();
      const deadline = now + 30 * 60;
      const amount = (100 * 1e6).toString();
      const permit = await getPermit(user, usdt, amount, vault.address, deadline);

      const tariff = data.router.tariff(state) as any;
      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = await router.connect(user).createWithPermit(
        tariff,
        {
          user: user.address,
          token: usdt.address,
          amount: 90 * 1e6,
        },
        signature,
        permit,
      );

      const {status, events} = await tx.wait();
      const event1 = events?.[0] as any;
      const event2 = events?.[1] as any;
      const event3 = events?.[2] as any;
      const event4 = events?.[3] as any;

      const userBalanceAfter = await usdt.balanceOf(user.address);
      const vaultBalanceAfter = await usdt.balanceOf(vault.address);

      expect(status).eq(1);
      expect(events).length(4);

      expect(event1.address).to.be.equal(usdt.address);
      expect(event1.topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Approval(address,address,uint256)")),
        user.address,
        vault.address,
      ]);
      expect(parseInt(event1.data, 16)).to.be.equal(100 * 1e6);

      expect(event2.address).to.be.equal(usdt.address);
      expect(event2.topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Approval(address,address,uint256)")),
        user.address,
        vault.address,
      ]);
      expect(parseInt(event2.data, 16)).to.be.equal(10 * 1e6);

      expect(event3.address).to.be.equal(usdt.address);
      expect(event3.topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Transfer(address,address,uint256)")),
        user.address,
        vault.address,
      ]);
      expect(parseInt(event3.data, 16)).to.be.equal(90 * 1e6);

      expect(event4.event).eq("DualCreated");
      expect(event4.args).length(8);
      expect(event4.args[0]).eq(user.address);
      expect(event4.args[1]).eq(network.config.chainId);
      expect(event4.args[2]).eq(tariff.baseToken);
      expect(event4.args[3]).eq(tariff.quoteToken);
      expect(event4.args[4]).eq(usdt.address);
      expect(event4.args[5]).eq(90 * 1e6);
      expect(event4.args[6]).eq(tariff.stakingPeriod);
      expect(event4.args[7]).eq(tariff.yield);

      expect(userBalanceBefore).eq(100 * 1e6);
      expect(userBalanceAfter).eq(10 * 1e6);

      expect(vaultBalanceBefore).eq(0);
      expect(vaultBalanceAfter).eq(90 * 1e6);
    });

    it("should create with permit by mpc", async () => {
      const state = await loadFixture(deploy);
      const {router, vault, user, mpc, usdt} = state;

      // top up user to be sure here's enough funds to withdraw
      await usdt.transfer(user.address, 100 * 1e6);

      const userBalanceBefore = await usdt.balanceOf(user.address);
      const vaultBalanceBefore = await usdt.balanceOf(vault.address);

      const now = await time.latest();
      const deadline = now + 30 * 60;
      const amount = (100 * 1e6).toString();
      const permit = await getPermit(user, usdt, amount, vault.address, deadline);

      const tariff = data.router.tariff(state) as any;
      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = await router.connect(mpc).createWithPermit(
        tariff,
        {
          user: user.address,
          token: usdt.address,
          amount: 90 * 1e6,
        },
        signature,
        permit,
      );

      const {status, events} = await tx.wait();
      const event1 = events?.[0] as any;
      const event2 = events?.[1] as any;
      const event3 = events?.[2] as any;
      const event4 = events?.[3] as any;

      const userBalanceAfter = await usdt.balanceOf(user.address);
      const vaultBalanceAfter = await usdt.balanceOf(vault.address);

      expect(status).eq(1);
      expect(events).length(4);

      expect(event1.address).to.be.equal(usdt.address);
      expect(event1.topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Approval(address,address,uint256)")),
        user.address,
        vault.address,
      ]);
      expect(parseInt(event1.data, 16)).to.be.equal(100 * 1e6);

      expect(event2.address).to.be.equal(usdt.address);
      expect(event2.topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Approval(address,address,uint256)")),
        user.address,
        vault.address,
      ]);
      expect(parseInt(event2.data, 16)).to.be.equal(10 * 1e6);

      expect(event3.address).to.be.equal(usdt.address);
      expect(event3.topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Transfer(address,address,uint256)")),
        user.address,
        vault.address,
      ]);
      expect(parseInt(event3.data, 16)).to.be.equal(90 * 1e6);

      expect(event4.event).eq("DualCreated");
      expect(event4.args).length(8);
      expect(event4.args[0]).eq(user.address);
      expect(event4.args[1]).eq(network.config.chainId);
      expect(event4.args[2]).eq(tariff.baseToken);
      expect(event4.args[3]).eq(tariff.quoteToken);
      expect(event4.args[4]).eq(usdt.address);
      expect(event4.args[5]).eq(90 * 1e6);
      expect(event4.args[6]).eq(tariff.stakingPeriod);
      expect(event4.args[7]).eq(tariff.yield);

      expect(userBalanceBefore).eq(100 * 1e6);
      expect(userBalanceAfter).eq(10 * 1e6);

      expect(vaultBalanceBefore).eq(0);
      expect(vaultBalanceAfter).eq(90 * 1e6);
    });

    it("should create with permit w/ custom tariff", async () => {
      const state = await loadFixture(deploy);
      const {router, vault, user, receiver, mpc, usdt} = state;

      // top up user to be sure here's enough funds to withdraw
      await usdt.transfer(user.address, 100 * 1e6);

      const userBalanceBefore = await usdt.balanceOf(user.address);
      const vaultBalanceBefore = await usdt.balanceOf(vault.address);

      const now = await time.latest();
      const deadline = now + 30 * 60;
      const amount = (100 * 1e6).toString();

      const permit1 = await getPermit(user, usdt, amount, vault.address, deadline);
      const permit2 = await getPermit(receiver, usdt, amount, vault.address, deadline);

      const tariff = {
        ...data.router.tariff(state),
        user: user.address,
      } as any;

      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx1 = await router.connect(user).createWithPermit(
        tariff,
        {
          user: user.address,
          token: usdt.address,
          amount: 90 * 1e6,
        },
        signature,
        permit1,
      );

      const tx2 = router.connect(receiver).createWithPermit(
        tariff,
        {
          user: receiver.address,
          token: usdt.address,
          amount: 90 * 1e6,
        },
        signature,
        permit2,
      );

      await expect(tx2).to.be.revertedWith("Router: Bad tariff user");

      const {status, events} = await tx1.wait();
      const event1 = events?.[0] as any;
      const event2 = events?.[1] as any;
      const event3 = events?.[2] as any;
      const event4 = events?.[3] as any;

      const userBalanceAfter = await usdt.balanceOf(user.address);
      const vaultBalanceAfter = await usdt.balanceOf(vault.address);

      expect(status).eq(1);
      expect(events).length(4);

      expect(event1.address).to.be.equal(usdt.address);
      expect(event1.topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Approval(address,address,uint256)")),
        user.address,
        vault.address,
      ]);
      expect(parseInt(event1.data, 16)).to.be.equal(100 * 1e6);

      expect(event2.address).to.be.equal(usdt.address);
      expect(event2.topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Approval(address,address,uint256)")),
        user.address,
        vault.address,
      ]);
      expect(parseInt(event2.data, 16)).to.be.equal(10 * 1e6);

      expect(event3.address).to.be.equal(usdt.address);
      expect(event3.topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Transfer(address,address,uint256)")),
        user.address,
        vault.address,
      ]);
      expect(parseInt(event3.data, 16)).to.be.equal(90 * 1e6);

      expect(event4.event).eq("DualCreated");
      expect(event4.args).length(8);
      expect(event4.args[0]).eq(user.address);
      expect(event4.args[1]).eq(network.config.chainId);
      expect(event4.args[2]).eq(tariff.baseToken);
      expect(event4.args[3]).eq(tariff.quoteToken);
      expect(event4.args[4]).eq(usdt.address);
      expect(event4.args[5]).eq(90 * 1e6);
      expect(event4.args[6]).eq(tariff.stakingPeriod);
      expect(event4.args[7]).eq(tariff.yield);

      expect(userBalanceBefore).eq(100 * 1e6);
      expect(userBalanceAfter).eq(10 * 1e6);

      expect(vaultBalanceBefore).eq(0);
      expect(vaultBalanceAfter).eq(90 * 1e6);
    });

    it("should create with permit w/ base threshold balancing", async () => {
      const state = await loadFixture(deploy);
      const {router, vault, user, mpc, btcb} = state;

      // top up user to be sure here's enough funds to withdraw
      await btcb.transfer(user.address, toAmountUint256(1));

      const userBalanceBefore = await btcb.balanceOf(user.address);
      const vaultBalanceBefore = await btcb.balanceOf(vault.address);
      const mpcBalanceBefore = await btcb.balanceOf(mpc.address);

      const now = await time.latest();
      const deadline = now + 30 * 60;
      const amount = toAmountUint256(1);
      const permit = await getPermit(user, btcb, amount, vault.address, deadline);

      const tariff = data.router.tariff(state) as any;
      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = await router.connect(user).createWithPermit(
        tariff,
        {
          user: user.address,
          token: btcb.address,
          amount: toAmountUint256(0.9),
        },
        signature,
        permit,
      );

      const {status, events} = await tx.wait();
      const event1 = events?.[0] as any;
      const event2 = events?.[1] as any;
      const event3 = events?.[2] as any;
      const event4 = events?.[3] as any;

      const userBalanceAfter = await btcb.balanceOf(user.address);
      const vaultBalanceAfter = await btcb.balanceOf(vault.address);
      const mpcBalanceAfter = await btcb.balanceOf(mpc.address);

      expect(status).eq(1);
      expect(events).length(4);

      expect(event1.address).to.be.equal(btcb.address);
      expect(event1.topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Approval(address,address,uint256)")),
        user.address,
        vault.address,
      ]);
      expect(parseInt(event1.data, 16).toString()).to.be.equal(toAmountUint256(1));

      expect(event2.address).to.be.equal(btcb.address);
      expect(event2.topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Approval(address,address,uint256)")),
        user.address,
        vault.address,
      ]);
      expect(parseInt(event2.data, 16).toString()).to.be.equal(toAmountUint256(0.1));

      expect(event3.address).to.be.equal(btcb.address);
      expect(event3.topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Transfer(address,address,uint256)")),
        user.address,
        mpc.address,
      ]);
      expect(parseInt(event3.data, 16).toString()).to.be.equal(toAmountUint256(0.9));

      expect(event4.event).eq("DualCreated");
      expect(event4.args).length(8);
      expect(event4.args[0]).eq(user.address);
      expect(event4.args[1]).eq(network.config.chainId);
      expect(event4.args[2]).eq(tariff.baseToken);
      expect(event4.args[3]).eq(tariff.quoteToken);
      expect(event4.args[4]).eq(btcb.address);
      expect(event4.args[5]).eq(toAmountUint256(0.9));
      expect(event4.args[6]).eq(tariff.stakingPeriod);
      expect(event4.args[7]).eq(tariff.yield);

      expect(userBalanceBefore).eq(toAmountUint256(1));
      expect(userBalanceAfter).eq(toAmountUint256(0.1));

      expect(vaultBalanceBefore).eq(0);
      expect(vaultBalanceAfter).eq(0);

      expect(mpcBalanceBefore).eq(0);
      expect(mpcBalanceAfter).eq(toAmountUint256(0.9));
    });

    it("should create with permit w/ quote threshold balancing", async () => {
      const state = await loadFixture(deploy);
      const {router, vault, user, mpc, usdt} = state;

      // top up user to be sure here's enough funds to withdraw
      await usdt.transfer(user.address, 30_000 * 1e6);

      const userBalanceBefore = await usdt.balanceOf(user.address);
      const vaultBalanceBefore = await usdt.balanceOf(vault.address);
      const mpcBalanceBefore = await usdt.balanceOf(mpc.address);

      const now = await time.latest();
      const deadline = now + 30 * 60;
      const amount = (30_000 * 1e6).toString();
      const permit = await getPermit(user, usdt, amount, vault.address, deadline);

      const tariff = data.router.tariff(state) as any;
      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = await router.connect(user).createWithPermit(
        tariff,
        {
          user: user.address,
          token: usdt.address,
          amount: 9000 * 1e6,
        },
        signature,
        permit,
      );

      const {status, events} = await tx.wait();
      const event1 = events?.[0] as any;
      const event2 = events?.[1] as any;
      const event3 = events?.[2] as any;
      const event4 = events?.[3] as any;

      const userBalanceAfter = await usdt.balanceOf(user.address);
      const vaultBalanceAfter = await usdt.balanceOf(vault.address);
      const mpcBalanceAfter = await usdt.balanceOf(mpc.address);

      expect(status).eq(1);
      expect(events).length(4);

      expect(event1.address).to.be.equal(usdt.address);
      expect(event1.topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Approval(address,address,uint256)")),
        user.address,
        vault.address,
      ]);
      expect(parseInt(event1.data, 16)).to.be.equal(30_000 * 1e6);

      expect(event2.address).to.be.equal(usdt.address);
      expect(event2.topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Approval(address,address,uint256)")),
        user.address,
        vault.address,
      ]);
      expect(parseInt(event2.data, 16)).to.be.equal(21_000 * 1e6);

      expect(event3.address).to.be.equal(usdt.address);
      expect(event3.topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Transfer(address,address,uint256)")),
        user.address,
        mpc.address,
      ]);
      expect(parseInt(event3.data, 16)).to.be.equal(9000 * 1e6);

      expect(event4.event).eq("DualCreated");
      expect(event4.args).length(8);
      expect(event4.args[0]).eq(user.address);
      expect(event4.args[1]).eq(network.config.chainId);
      expect(event4.args[2]).eq(tariff.baseToken);
      expect(event4.args[3]).eq(tariff.quoteToken);
      expect(event4.args[4]).eq(usdt.address);
      expect(event4.args[5]).eq(9000 * 1e6);
      expect(event4.args[6]).eq(tariff.stakingPeriod);
      expect(event4.args[7]).eq(tariff.yield);

      expect(userBalanceBefore).eq(30_000 * 1e6);
      expect(userBalanceAfter).eq(21_000 * 1e6);

      expect(vaultBalanceBefore).eq(0);
      expect(vaultBalanceAfter).eq(0);

      expect(mpcBalanceBefore).eq(0);
      expect(mpcBalanceAfter).eq(9000 * 1e6);
    });

    it("should not create with permit for another user", async () => {
      const state = await loadFixture(deploy);
      const {router, vault, user, receiver, mpc, usdt} = state;

      const now = await time.latest();
      const deadline = now + 30 * 60;
      const amount = (30_000 * 1e6).toString();
      const permit = await getPermit(receiver, usdt, amount, vault.address, deadline);

      const tariff = data.router.tariff(state) as any;
      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = router.connect(user).createWithPermit(
        tariff,
        {
          user: receiver.address,
          token: usdt.address,
          amount: 100 * 1e6,
        },
        signature,
        permit,
      );

      await expect(tx).to.be.revertedWith("Router: Access denied");
    });

    it("should not create with permit w/ bad input user", async () => {
      const state = await loadFixture(deploy);
      const {router, vault, user, mpc, usdt} = state;

      const now = await time.latest();
      const deadline = now + 30 * 60;
      const amount = (30_000 * 1e6).toString();
      const permit = await getPermit(user, usdt, amount, vault.address, deadline);

      const tariff = data.router.tariff(state) as any;
      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = router.connect(user).createWithPermit(
        tariff,
        {
          user: ethers.constants.AddressZero,
          token: usdt.address,
          amount: 100 * 1e6,
        },
        signature,
        permit,
      );

      await expect(tx).to.be.revertedWith("Router: Bad user");
    });

    it("should not create with permit w/ bad tariff chain id", async () => {
      const state = await loadFixture(deploy);
      const {router, vault, user, mpc, usdt} = state;

      const now = await time.latest();
      const deadline = now + 30 * 60;
      const amount = (30_000 * 1e6).toString();
      const permit = await getPermit(user, usdt, amount, vault.address, deadline);

      const tariff = {
        ...data.router.tariff(state),
        chainId: 1,
      } as any;

      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = router.connect(user).createWithPermit(
        tariff,
        {
          user: user.address,
          token: usdt.address,
          amount: 100 * 1e6,
        },
        signature,
        permit,
      );

      await expect(tx).to.be.revertedWith("MPCSignable: Must be MPC");
    });

    it("should not create with permit w/ expired tariff", async () => {
      const state = await loadFixture(deploy);
      const {router, vault, user, mpc, usdt} = state;

      const now = await time.latest();
      const deadline = now + 30 * 60;
      const amount = (30_000 * 1e6).toString();
      const permit = await getPermit(user, usdt, amount, vault.address, deadline);

      const tariff = {
        ...data.router.tariff(state),
        expireAt: Math.round(Date.now() / 1000 - 60).toString(),
      } as any;

      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = router.connect(user).createWithPermit(
        tariff,
        {
          user: user.address,
          token: usdt.address,
          amount: 100 * 1e6,
        },
        signature,
        permit,
      );

      await expect(tx).to.be.revertedWith("Router: Tariff expired");
    });

    it("should not create with permit w/ bad tariff user", async () => {
      const state = await loadFixture(deploy);
      const {router, vault, user, mpc, usdt} = state;

      const now = await time.latest();
      const deadline = now + 30 * 60;
      const amount = (30_000 * 1e6).toString();
      const permit = await getPermit(user, usdt, amount, vault.address, deadline);

      const tariff = {
        ...data.router.tariff(state),
        user: mpc.address,
      } as any;

      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = router.connect(user).createWithPermit(
        tariff,
        {
          user: user.address,
          token: usdt.address,
          amount: 100 * 1e6,
        },
        signature,
        permit,
      );

      await expect(tx).to.be.revertedWith("Router: Bad tariff user");
    });

    it("should not create with permit w/ bad yield", async () => {
      const state = await loadFixture(deploy);
      const {router, vault, user, mpc, usdt} = state;

      const now = await time.latest();
      const deadline = now + 30 * 60;
      const amount = (30_000 * 1e6).toString();
      const permit = await getPermit(user, usdt, amount, vault.address, deadline);

      const tariff = {
        ...data.router.tariff(state),
        yield: 0,
      } as any;

      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = router.connect(user).createWithPermit(
        tariff,
        {
          user: user.address,
          token: usdt.address,
          amount: 100 * 1e6,
        },
        signature,
        permit,
      );

      await expect(tx).to.be.revertedWith("Router: Bad tariff yield");
    });

    it("should not create with permit w/ bad stakingPeriod", async () => {
      const state = await loadFixture(deploy);
      const {router, vault, user, mpc, usdt} = state;

      const now = await time.latest();
      const deadline = now + 30 * 60;
      const amount = (30_000 * 1e6).toString();
      const permit = await getPermit(user, usdt, amount, vault.address, deadline);

      const tariff = {
        ...data.router.tariff(state),
        stakingPeriod: 0,
      } as any;

      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = router.connect(user).createWithPermit(
        tariff,
        {
          user: user.address,
          token: usdt.address,
          amount: 100 * 1e6,
        },
        signature,
        permit,
      );

      await expect(tx).to.be.revertedWith("Router: Bad tariff staking period");
    });

    it("should not create with permit w/ bad inputToken", async () => {
      const state = await loadFixture(deploy);
      const {router, vault, user, mpc, usdt} = state;

      const now = await time.latest();
      const deadline = now + 30 * 60;
      const amount = (30_000 * 1e6).toString();
      const permit = await getPermit(user, usdt, amount, vault.address, deadline);

      const tariff = data.router.tariff(state) as any;
      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = router.connect(user).createWithPermit(
        tariff,
        {
          user: user.address,
          token: ethers.constants.AddressZero,
          amount: 100 * 1e6,
        },
        signature,
        permit,
      );

      await expect(tx).to.be.revertedWith("Router: Input must be one from pair");
    });

    it("should not create with permit w/ bad signature", async () => {
      const state = await loadFixture(deploy);
      const {router, vault, user, mpc, usdt} = state;

      const now = await time.latest();
      const deadline = now + 30 * 60;
      const amount = (30_000 * 1e6).toString();
      const permit = await getPermit(user, usdt, amount, vault.address, deadline);

      const input = {
        user: user.address,
        token: usdt.address,
        amount: 100 * 1e6,
      };

      const tariff = data.router.tariff(state) as any;

      const signature1 = await mpc.signMessage(getTariffHash(tariff));
      const signature2 = await user.signMessage(getTariffHash(tariff));

      const tx1 = router.connect(user).createWithPermit(
        {
          ...tariff,
          yield: toYieldUint256(0.1),
        },
        input,
        signature1,
        permit,
      );

      const tx2 = router.connect(user).createWithPermit(tariff, input, signature2, permit);

      await expect(tx1).to.be.revertedWith("MPCSignable: Must be MPC");
      await expect(tx2).to.be.revertedWith("MPCSignable: Must be MPC");
    });

    it("should not create with permit if input is less than minBaseAmount", async () => {
      const state = await loadFixture(deploy);
      const {router, vault, user, mpc, btcb} = state;

      const now = await time.latest();
      const deadline = now + 30 * 60;
      const amount = toAmountUint256(10);
      const permit = await getPermit(user, btcb, amount, vault.address, deadline);

      const tariff = data.router.tariff(state) as any;
      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = router.connect(user).createWithPermit(
        tariff,
        {
          user: user.address,
          token: btcb.address,
          amount: toAmountUint256(0.01),
        },
        signature,
        permit,
      );

      await expect(tx).revertedWith("Router: Too small input amount");
    });

    it("should not create with permit if input is greater than maxBaseAmount", async () => {
      const state = await loadFixture(deploy);
      const {router, vault, user, mpc, btcb} = state;

      const now = await time.latest();
      const deadline = now + 30 * 60;
      const amount = toAmountUint256(100);
      const permit = await getPermit(user, btcb, amount, vault.address, deadline);

      const tariff = data.router.tariff(state) as any;
      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = router.connect(user).createWithPermit(
        tariff,
        {
          user: user.address,
          token: btcb.address,
          amount: toAmountUint256(100),
        },
        signature,
        permit,
      );

      await expect(tx).revertedWith("Router: Exceeds maximum input amount");
    });

    it("should not create with permit if input is less than minQuoteAmount", async () => {
      const state = await loadFixture(deploy);
      const {router, vault, user, mpc, usdt} = state;

      const now = await time.latest();
      const deadline = now + 30 * 60;
      const amount = (100 * 1e6).toString();
      const permit = await getPermit(user, usdt, amount, vault.address, deadline);

      const tariff = data.router.tariff(state) as any;
      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = router.connect(user).createWithPermit(
        tariff,
        {
          user: user.address,
          token: usdt.address,
          amount: 10 * 1e6,
        },
        signature,
        permit,
      );

      await expect(tx).revertedWith("Router: Too small input amount");
    });

    it("should not create with permit if input is greater than maxQuoteAmount", async () => {
      const state = await loadFixture(deploy);
      const {router, vault, user, mpc, usdt} = state;

      const now = await time.latest();
      const deadline = now + 30 * 60;
      const amount = (25_000 * 1e6).toString();
      const permit = await getPermit(user, usdt, amount, vault.address, deadline);

      const tariff = data.router.tariff(state) as any;
      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = router.connect(user).createWithPermit(
        tariff,
        {
          user: user.address,
          token: usdt.address,
          amount: 25_000 * 1e6,
        },
        signature,
        permit,
      );

      await expect(tx).revertedWith("Router: Exceeds maximum input amount");
    });

    it("should not create with permit if has not enough funds", async () => {
      const state = await loadFixture(deploy);
      const {router, vault, user, mpc, usdt} = state;

      const now = await time.latest();
      const deadline = now + 30 * 60;
      const amount = (5000 * 1e6).toString();
      const permit = await getPermit(user, usdt, amount, vault.address, deadline);

      const tariff = data.router.tariff(state) as any;
      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = router.connect(user).createWithPermit(
        tariff,
        {
          user: user.address,
          token: usdt.address,
          amount: 5000 * 1e6,
        },
        signature,
        permit,
      );

      await expect(tx).to.be.revertedWith("ERC20: transfer amount exceeds balance");
    });

    it("should not create with permit if has not enough allowance", async () => {
      const state = await loadFixture(deploy);
      const {router, vault, user, mpc, usdt} = state;

      // top up user to be sure here's enough funds to withdraw
      await usdt.transfer(user.address, 5000 * 1e6);

      const now = await time.latest();
      const deadline = now + 30 * 60;
      const amount = (500 * 1e6).toString();
      const permit = await getPermit(user, usdt, amount, vault.address, deadline);

      const tariff = data.router.tariff(state) as any;
      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = router.connect(user).createWithPermit(
        tariff,
        {
          user: user.address,
          token: usdt.address,
          amount: 1000 * 1e6,
        },
        signature,
        permit,
      );

      await expect(tx).to.be.revertedWith("ERC20: insufficient allowance");
    });

    it("should not create with permit if expired", async () => {
      const state = await loadFixture(deploy);
      const {router, vault, user, mpc, usdt} = state;

      // top up user to be sure here's enough funds to withdraw
      await usdt.transfer(user.address, 1000 * 1e6);

      const now = await time.latest();
      const deadline = now - 30 * 60;
      const amount = (1000 * 1e6).toString();
      const permit = await getPermit(user, usdt, amount, vault.address, deadline);

      const tariff = data.router.tariff(state) as any;
      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = router.connect(user).createWithPermit(
        tariff,
        {
          user: user.address,
          token: usdt.address,
          amount: 100 * 1e6,
        },
        signature,
        permit,
      );

      await expect(tx).to.be.revertedWith("ERC20Permit: expired deadline");
    });

    it("should not create with permit if spender not matched", async () => {
      const state = await loadFixture(deploy);
      const {router, user, mpc, usdt} = state;

      // top up user to be sure here's enough funds to withdraw
      await usdt.transfer(user.address, 1000 * 1e6);

      const now = await time.latest();
      const deadline = now + 30 * 60;
      const amount = (1000 * 1e6).toString();
      const permit = await getPermit(user, usdt, amount, user.address, deadline);

      const tariff = data.router.tariff(state) as any;
      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = router.connect(user).createWithPermit(
        tariff,
        {
          user: user.address,
          token: usdt.address,
          amount: 100 * 1e6,
        },
        signature,
        permit,
      );

      await expect(tx).to.be.revertedWith("ERC20Permit: invalid signature");
    });

    it("should not create with permit if paused", async () => {
      const state = await loadFixture(deploy);
      const {router, vault, user, mpc, usdt} = state;

      await router.connect(mpc).pause();

      const now = await time.latest();
      const deadline = now + 30 * 60;
      const amount = (1000 * 1e6).toString();
      const permit = await getPermit(user, usdt, amount, vault.address, deadline);

      const tariff = data.router.tariff(state) as any;
      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = router.connect(user).createWithPermit(
        tariff,
        {
          user: user.address,
          token: usdt.address,
          amount: 100 * 1e6,
        },
        signature,
        permit,
      );

      await expect(tx).revertedWith("Pausable: paused");
    });
  });

  describe("createETH()", () => {
    it("should create eth", async () => {
      const state = await loadFixture(deploy);
      const {router, vault, user, mpc, weth} = state;

      const userValueBefore = await ethers.provider.getBalance(user.address);
      const vaultValueBefore = await ethers.provider.getBalance(vault.address);

      const tariff = {
        ...data.router.tariff(state),
        baseToken: weth.address,
      } as any;

      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = await router.connect(user).createETH(tariff, signature, {
        value: parseEther("0.2"),
      });

      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);
      const event = receipt.events?.[0] as any;

      const userValueAfter = await ethers.provider.getBalance(user.address);
      const vaultValueAfter = await ethers.provider.getBalance(vault.address);

      expect(receipt.status).eq(1);
      expect(receipt.events).length(1);

      expect(event.event).eq("DualCreated");
      expect(event.args).length(8);
      expect(event.args[0]).eq(user.address);
      expect(event.args[1]).eq(network.config.chainId);
      expect(event.args[2]).eq(tariff.baseToken);
      expect(event.args[3]).eq(tariff.quoteToken);
      expect(event.args[4]).eq(weth.address);
      expect(event.args[5]).eq(parseEther("0.2"));
      expect(event.args[6]).eq(tariff.stakingPeriod);
      expect(event.args[7]).eq(tariff.yield);

      expect(userValueAfter.add(gasUsed).sub(userValueBefore)).eq(parseEther("-0.2"));

      expect(vaultValueBefore).eq(0);
      expect(vaultValueAfter).eq(parseEther("0.2"));
    });

    it("should create eth w/ custom tariff", async () => {
      const state = await loadFixture(deploy);
      const {router, vault, user, receiver, mpc, weth} = state;

      const userValueBefore = await ethers.provider.getBalance(user.address);
      const vaultValueBefore = await ethers.provider.getBalance(vault.address);

      const tariff = {
        ...data.router.tariff(state),
        baseToken: weth.address,
        user: user.address,
      } as any;

      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx1 = await router.connect(user).createETH(tariff, signature, {
        value: parseEther("0.2"),
      });

      const tx2 = router.connect(receiver).createETH(tariff, signature, {
        value: parseEther("0.3"),
      });

      await expect(tx2).to.be.revertedWith("Router: Bad tariff user");

      const receipt = await tx1.wait();
      const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);
      const event = receipt.events?.[0] as any;

      const userValueAfter = await ethers.provider.getBalance(user.address);
      const vaultValueAfter = await ethers.provider.getBalance(vault.address);

      expect(receipt.status).eq(1);
      expect(receipt.events).length(1);

      expect(event.event).eq("DualCreated");
      expect(event.args).length(8);
      expect(event.args[0]).eq(user.address);
      expect(event.args[1]).eq(network.config.chainId);
      expect(event.args[2]).eq(tariff.baseToken);
      expect(event.args[3]).eq(tariff.quoteToken);
      expect(event.args[4]).eq(weth.address);
      expect(event.args[5]).eq(parseEther("0.2"));
      expect(event.args[6]).eq(tariff.stakingPeriod);
      expect(event.args[7]).eq(tariff.yield);

      expect(userValueAfter.add(gasUsed).sub(userValueBefore)).eq(parseEther("-0.2"));

      expect(vaultValueBefore).eq(0);
      expect(vaultValueAfter).eq(parseEther("0.2"));
    });

    it("should create eth w/ base threshold balancing", async () => {
      const state = await loadFixture(deploy);
      const {router, vault, user, mpc, weth} = state;

      const userValueBefore = await ethers.provider.getBalance(user.address);
      const vaultValueBefore = await ethers.provider.getBalance(vault.address);
      const mpcValueBefore = await ethers.provider.getBalance(mpc.address);

      const tariff = {
        ...data.router.tariff(state),
        baseToken: weth.address,
      } as any;

      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = await router.connect(user).createETH(tariff, signature, {
        value: parseEther("2"),
      });

      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);
      const event = receipt.events?.[0] as any;

      const userValueAfter = await ethers.provider.getBalance(user.address);
      const vaultValueAfter = await ethers.provider.getBalance(vault.address);
      const mpcValueAfter = await ethers.provider.getBalance(mpc.address);

      expect(receipt.status).eq(1);
      expect(receipt.events).length(1);

      expect(event.event).eq("DualCreated");
      expect(event.args).length(8);
      expect(event.args[0]).eq(user.address);
      expect(event.args[1]).eq(network.config.chainId);
      expect(event.args[2]).eq(tariff.baseToken);
      expect(event.args[3]).eq(tariff.quoteToken);
      expect(event.args[4]).eq(weth.address);
      expect(event.args[5]).eq(parseEther("2"));
      expect(event.args[6]).eq(tariff.stakingPeriod);
      expect(event.args[7]).eq(tariff.yield);

      expect(userValueAfter.add(gasUsed).sub(userValueBefore)).eq(parseEther("-2"));

      expect(vaultValueBefore).eq(0);
      expect(vaultValueAfter).eq(0);

      expect(mpcValueAfter.sub(mpcValueBefore)).eq(parseEther("2"));
    });

    it("should create eth w/ quote threshold balancing", async () => {
      const state = await loadFixture(deploy);
      const {router, vault, user, mpc, weth} = state;

      const userValueBefore = await ethers.provider.getBalance(user.address);
      const vaultValueBefore = await ethers.provider.getBalance(vault.address);
      const mpcValueBefore = await ethers.provider.getBalance(mpc.address);

      const tariff = {
        ...data.router.tariff(state),
        quoteToken: weth.address,
        minQuoteAmount: toAmountUint256(0.1),
        maxQuoteAmount: toAmountUint256(10),
        thresholdQuoteAmount: toAmountUint256(0.5),
      } as any;

      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = await router.connect(user).createETH(tariff, signature, {
        value: parseEther("2"),
      });

      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);
      const event = receipt.events?.[0] as any;

      const userValueAfter = await ethers.provider.getBalance(user.address);
      const vaultValueAfter = await ethers.provider.getBalance(vault.address);
      const mpcValueAfter = await ethers.provider.getBalance(mpc.address);

      expect(receipt.status).eq(1);
      expect(receipt.events).length(1);

      expect(event.event).eq("DualCreated");
      expect(event.args).length(8);
      expect(event.args[0]).eq(user.address);
      expect(event.args[1]).eq(network.config.chainId);
      expect(event.args[2]).eq(tariff.baseToken);
      expect(event.args[3]).eq(tariff.quoteToken);
      expect(event.args[4]).eq(weth.address);
      expect(event.args[5]).eq(parseEther("2"));
      expect(event.args[6]).eq(tariff.stakingPeriod);
      expect(event.args[7]).eq(tariff.yield);

      expect(userValueAfter.add(gasUsed).sub(userValueBefore)).eq(parseEther("-2"));

      expect(vaultValueBefore).eq(0);
      expect(vaultValueAfter).eq(0);

      expect(mpcValueAfter.sub(mpcValueBefore)).eq(parseEther("2"));
    });

    it("should not create eth w/ expired tariff", async () => {
      const state = await loadFixture(deploy);
      const {router, user, mpc, weth} = state;

      const tariff = {
        ...data.router.tariff(state),
        baseToken: weth.address,
        expireAt: Math.round(Date.now() / 1000 - 60).toString(),
      } as any;

      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = router.connect(user).createETH(tariff, signature, {
        value: parseEther("1"),
      });

      await expect(tx).to.be.revertedWith("Router: Tariff expired");
    });

    it("should not create eth w/ bad tariff chain id", async () => {
      const state = await loadFixture(deploy);
      const {router, user, mpc, weth} = state;

      const tariff = {
        ...data.router.tariff(state),
        baseToken: weth.address,
        chainId: 1,
      } as any;

      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = router.connect(user).createETH(tariff, signature, {
        value: parseEther("1"),
      });

      await expect(tx).to.be.revertedWith("MPCSignable: Must be MPC");
    });

    it("should not create eth w/ bad tariff user", async () => {
      const state = await loadFixture(deploy);
      const {router, user, mpc, weth} = state;

      const tariff = {
        ...data.router.tariff(state),
        baseToken: weth.address,
        user: mpc.address,
      } as any;

      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = router.connect(user).createETH(tariff, signature, {
        value: parseEther("1"),
      });

      await expect(tx).to.be.revertedWith("Router: Bad tariff user");
    });

    it("should not create eth w/ bad yield", async () => {
      const state = await loadFixture(deploy);
      const {router, user, mpc, weth} = state;

      const tariff = {
        ...data.router.tariff(state),
        baseToken: weth.address,
        yield: 0,
      } as any;

      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = router.connect(user).createETH(tariff, signature, {
        value: parseEther("1"),
      });

      await expect(tx).to.be.revertedWith("Router: Bad tariff yield");
    });

    it("should not create eth w/ bad stakingPeriod", async () => {
      const state = await loadFixture(deploy);
      const {router, user, mpc, weth} = state;

      const tariff = {
        ...data.router.tariff(state),
        baseToken: weth.address,
        stakingPeriod: 0,
      } as any;

      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = router.connect(user).createETH(tariff, signature, {
        value: parseEther("1"),
      });

      await expect(tx).to.be.revertedWith("Router: Bad tariff staking period");
    });

    it("should not create eth w/ bad inputToken", async () => {
      const state = await loadFixture(deploy);
      const {router, user, mpc} = state;

      const tariff = data.router.tariff(state) as any;
      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = router.connect(user).createETH(tariff, signature, {
        value: parseEther("1"),
      });

      await expect(tx).revertedWith("Router: Input must be one from pair");
    });

    it("should not create eth w/ bad signature", async () => {
      const state = await loadFixture(deploy);
      const {router, user, mpc, weth} = state;

      const tariff = {
        ...data.router.tariff(state),
        baseToken: weth.address,
        stakingPeriod: 0,
      } as any;

      const signature1 = await mpc.signMessage(getTariffHash(tariff));
      const signature2 = await user.signMessage(getTariffHash(tariff));

      const tx1 = router.connect(user).createETH(
        {
          ...tariff,
          yield: toYieldUint256(0.1),
        },
        signature1,
      );

      const tx2 = router.connect(user).createETH(tariff, signature2);

      await expect(tx1).to.be.revertedWith("MPCSignable: Must be MPC");
      await expect(tx2).to.be.revertedWith("MPCSignable: Must be MPC");
    });

    it("should not create eth if input is less than minBaseAmount", async () => {
      const state = await loadFixture(deploy);
      const {router, user, mpc, weth} = state;

      const tariff = {
        ...data.router.tariff(state),
        baseToken: weth.address,
      } as any;

      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = router.connect(user).createETH(tariff, signature, {
        value: parseEther("0.01"),
      });

      await expect(tx).revertedWith("Router: Too small input amount");
    });

    it("should not create eth if input is greater than maxBaseAmount", async () => {
      const state = await loadFixture(deploy);
      const {router, user, mpc, weth} = state;

      const tariff = {
        ...data.router.tariff(state),
        baseToken: weth.address,
      } as any;

      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = router.connect(user).createETH(tariff, signature, {
        value: parseEther("20"),
      });

      await expect(tx).revertedWith("Router: Exceeds maximum input amount");
    });

    it("should not create eth if input is less than minQuoteAmount", async () => {
      const state = await loadFixture(deploy);
      const {router, user, mpc, weth} = state;

      const tariff = {
        ...data.router.tariff(state),
        quoteToken: weth.address,
        minQuoteAmount: toAmountUint256(0.01),
        maxQuoteAmount: toAmountUint256(10),
        thresholdQuoteAmount: toAmountUint256(0.5),
      } as any;

      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = router.connect(user).createETH(tariff, signature, {
        value: parseEther("0.001"),
      });

      await expect(tx).revertedWith("Router: Too small input amount");
    });

    it("should not create eth if input is greater than maxQuoteAmount", async () => {
      const state = await loadFixture(deploy);
      const {router, user, mpc, weth} = state;

      const tariff = {
        ...data.router.tariff(state),
        quoteToken: weth.address,
        minQuoteAmount: toAmountUint256(0.1),
        maxQuoteAmount: toAmountUint256(100),
        thresholdQuoteAmount: toAmountUint256(0.5),
      } as any;

      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = router.connect(user).createETH(tariff, signature, {
        value: parseEther("105"),
      });

      await expect(tx).revertedWith("Router: Exceeds maximum input amount");
    });

    it("should not create eth if paused", async () => {
      const state = await loadFixture(deploy);
      const {router, user, mpc, weth} = state;

      await router.connect(mpc).pause();

      const tariff = {
        ...data.router.tariff(state),
        quoteToken: weth.address,
      } as any;

      const signature = await mpc.signMessage(getTariffHash(tariff));

      const tx = router.connect(user).createETH(tariff, signature, {
        value: parseEther("1"),
      });

      await expect(tx).revertedWith("Pausable: paused");
    });
  });

  describe("claim()", () => {
    it("should claim tokens", async () => {
      const {router, vault, user, mpc, btcb} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to withdraw
      await btcb.transfer(vault.address, toAmountUint256(10));

      const txHash = "0xba5cd6f533e448e71786fdf5eeda4c3d47d6f616cb40b210cd9943f06677fe7e";

      const hash = utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["uint256", "address", "address", "uint256", "bytes32"],
          [network.config.chainId, user.address, btcb.address, toAmountUint256(1.1), txHash],
        ),
      );

      const signature = await mpc.signMessage(ethers.utils.arrayify(hash));

      const userBalanceBefore = await btcb.balanceOf(user.address);
      const vaultBalanceBefore = await btcb.balanceOf(vault.address);
      const claimedBefore = await router.claimed(txHash);

      const tx = await router
        .connect(user)
        .claim(user.address, user.address, btcb.address, toAmountUint256(1.1), txHash, signature);

      const {status, events} = await tx.wait();
      const event1 = events?.[0] as any;
      const event2 = events?.[1] as any;

      const userBalanceAfter = await btcb.balanceOf(user.address);
      const vaultBalanceAfter = await btcb.balanceOf(vault.address);
      const claimedAfter = await router.claimed(txHash);

      expect(status).eq(1);
      expect(events).length(2);

      expect(event1.address).to.be.equal(btcb.address);
      expect(event1.topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Transfer(address,address,uint256)")),
        vault.address,
        user.address,
      ]);
      expect(parseInt(event1.data, 16).toString()).to.be.equal(toAmountUint256(1.1));

      expect(event2.event).eq("DualClaimed");
      expect(event2.args).length(5);
      expect(event2.args[0]).eq(user.address);
      expect(event2.args[1]).eq(user.address);
      expect(event2.args[2]).eq(btcb.address);
      expect(event2.args[3]).eq(toAmountUint256(1.1));
      expect(event2.args[4]).eq(txHash);

      expect(userBalanceBefore).eq(0);
      expect(userBalanceAfter).eq(toAmountUint256(1.1));

      expect(vaultBalanceBefore).eq(toAmountUint256(10));
      expect(vaultBalanceAfter).eq(toAmountUint256(8.9));

      expect(claimedBefore).eq(false);
      expect(claimedAfter).eq(true);
    });

    it("should claim eth", async () => {
      const {router, vault, user, mpc, weth} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to withdraw
      await vault.deposit({value: parseEther("100")});

      const txHash = "0xba5cd6f533e448e71786fdf5eeda4c3d47d6f616cb40b210cd9943f06677fe7e";

      const hash = utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["uint256", "address", "address", "uint256", "bytes32"],
          [network.config.chainId, user.address, weth.address, parseEther("2"), txHash],
        ),
      );

      const signature = await mpc.signMessage(ethers.utils.arrayify(hash));

      const userValueBefore = await ethers.provider.getBalance(user.address);
      const vaultValueBefore = await ethers.provider.getBalance(vault.address);
      const claimedBefore = await router.claimed(txHash);

      const tx = await router
        .connect(user)
        .claim(user.address, user.address, weth.address, parseEther("2"), txHash, signature);

      const receipt = await tx.wait();
      const event = receipt.events?.[0] as any;
      const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);

      const userValueAfter = await ethers.provider.getBalance(user.address);
      const vaultValueAfter = await ethers.provider.getBalance(vault.address);
      const claimedAfter = await router.claimed(txHash);

      expect(receipt.status).eq(1);
      expect(receipt.events).length(1);

      expect(event.event).eq("DualClaimed");
      expect(event.args).length(5);
      expect(event.args[0]).eq(user.address);
      expect(event.args[1]).eq(user.address);
      expect(event.args[2]).eq(weth.address);
      expect(event.args[3]).eq(parseEther("2"));
      expect(event.args[4]).eq(txHash);

      expect(userValueAfter.add(gasUsed).sub(userValueBefore)).eq(parseEther("2"));
      expect(vaultValueAfter.sub(vaultValueBefore)).eq(parseEther("-2"));

      expect(claimedBefore).eq(false);
      expect(claimedAfter).eq(true);
    });

    it("should claim by mpc", async () => {
      const {router, vault, user, mpc, btcb} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to withdraw
      await btcb.transfer(vault.address, toAmountUint256(10));

      // pause router to check that claim is still available
      await router.connect(mpc).pause();

      const txHash = "0xba5cd6f533e448e71786fdf5eeda4c3d47d6f616cb40b210cd9943f06677fe7e";

      const hash = utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["uint256", "address", "address", "uint256", "bytes32"],
          [network.config.chainId, user.address, btcb.address, toAmountUint256(1.1), txHash],
        ),
      );

      const signature = await mpc.signMessage(ethers.utils.arrayify(hash));

      const userBalanceBefore = await btcb.balanceOf(user.address);
      const vaultBalanceBefore = await btcb.balanceOf(vault.address);
      const claimedBefore = await router.claimed(txHash);

      const tx = await router
        .connect(mpc)
        .claim(user.address, user.address, btcb.address, toAmountUint256(1.1), txHash, signature);

      const {status, events} = await tx.wait();
      const event1 = events?.[0] as any;
      const event2 = events?.[1] as any;

      const userBalanceAfter = await btcb.balanceOf(user.address);
      const vaultBalanceAfter = await btcb.balanceOf(vault.address);
      const claimedAfter = await router.claimed(txHash);

      expect(status).eq(1);
      expect(events).length(2);

      expect(event1.address).to.be.equal(btcb.address);
      expect(event1.topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Transfer(address,address,uint256)")),
        vault.address,
        user.address,
      ]);
      expect(parseInt(event1.data, 16).toString()).to.be.equal(toAmountUint256(1.1));

      expect(event2.event).eq("DualClaimed");
      expect(event2.args).length(5);
      expect(event2.args[0]).eq(user.address);
      expect(event2.args[1]).eq(user.address);
      expect(event2.args[2]).eq(btcb.address);
      expect(event2.args[3]).eq(toAmountUint256(1.1));
      expect(event2.args[4]).eq(txHash);

      expect(userBalanceBefore).eq(0);
      expect(userBalanceAfter).eq(toAmountUint256(1.1));

      expect(vaultBalanceBefore).eq(toAmountUint256(10));
      expect(vaultBalanceAfter).eq(toAmountUint256(8.9));

      expect(claimedBefore).eq(false);
      expect(claimedAfter).eq(true);
    });

    it("should claim to another receiver", async () => {
      const {router, vault, user, mpc, receiver, btcb} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to withdraw
      await btcb.transfer(vault.address, toAmountUint256(10));

      const txHash = "0xba5cd6f533e448e71786fdf5eeda4c3d47d6f616cb40b210cd9943f06677fe7e";

      const hash = utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["uint256", "address", "address", "uint256", "bytes32"],
          [network.config.chainId, user.address, btcb.address, toAmountUint256(1.1), txHash],
        ),
      );

      const signature = await mpc.signMessage(ethers.utils.arrayify(hash));

      const userBalanceBefore = await btcb.balanceOf(user.address);
      const receiverBalanceBefore = await btcb.balanceOf(receiver.address);
      const vaultBalanceBefore = await btcb.balanceOf(vault.address);
      const claimedBefore = await router.claimed(txHash);

      const tx = await router
        .connect(user)
        .claim(user.address, receiver.address, btcb.address, toAmountUint256(1.1), txHash, signature);

      const {status, events} = await tx.wait();
      const event1 = events?.[0] as any;
      const event2 = events?.[1] as any;

      const userBalanceAfter = await btcb.balanceOf(user.address);
      const receiverBalanceAfter = await btcb.balanceOf(receiver.address);
      const vaultBalanceAfter = await btcb.balanceOf(vault.address);
      const claimedAfter = await router.claimed(txHash);

      expect(status).eq(1);
      expect(events).length(2);

      expect(event1.address).to.be.equal(btcb.address);
      expect(event1.topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Transfer(address,address,uint256)")),
        vault.address,
        receiver.address,
      ]);
      expect(parseInt(event1.data, 16).toString()).to.be.equal(toAmountUint256(1.1));

      expect(event2.event).eq("DualClaimed");
      expect(event2.args).length(5);
      expect(event2.args[0]).eq(user.address);
      expect(event2.args[1]).eq(receiver.address);
      expect(event2.args[2]).eq(btcb.address);
      expect(event2.args[3]).eq(toAmountUint256(1.1));
      expect(event2.args[4]).eq(txHash);

      expect(userBalanceBefore).eq(0);
      expect(userBalanceAfter).eq(0);

      expect(receiverBalanceBefore).eq(0);
      expect(receiverBalanceAfter).eq(toAmountUint256(1.1));

      expect(vaultBalanceBefore).eq(toAmountUint256(10));
      expect(vaultBalanceAfter).eq(toAmountUint256(8.9));

      expect(claimedBefore).eq(false);
      expect(claimedAfter).eq(true);
    });

    it("should not claim to another receiver by mpc", async () => {
      const {router, vault, user, mpc, receiver, btcb} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to withdraw
      await btcb.transfer(vault.address, toAmountUint256(10));

      const txHash = "0xba5cd6f533e448e71786fdf5eeda4c3d47d6f616cb40b210cd9943f06677fe7e";

      const hash = utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["uint256", "address", "address", "uint256", "bytes32"],
          [network.config.chainId, user.address, btcb.address, toAmountUint256(1.1), txHash],
        ),
      );

      const signature = await mpc.signMessage(ethers.utils.arrayify(hash));

      const userBalanceBefore = await btcb.balanceOf(user.address);
      const receiverBalanceBefore = await btcb.balanceOf(receiver.address);
      const vaultBalanceBefore = await btcb.balanceOf(vault.address);
      const claimedBefore = await router.claimed(txHash);

      const tx = router
        .connect(mpc)
        .claim(user.address, receiver.address, btcb.address, toAmountUint256(1.1), txHash, signature);

      await expect(tx).to.be.revertedWith("Router: Bad sender");

      const userBalanceAfter = await btcb.balanceOf(user.address);
      const receiverBalanceAfter = await btcb.balanceOf(receiver.address);
      const vaultBalanceAfter = await btcb.balanceOf(vault.address);
      const claimedAfter = await router.claimed(txHash);

      expect(userBalanceBefore).eq(0);
      expect(userBalanceAfter).eq(0);

      expect(receiverBalanceBefore).eq(0);
      expect(receiverBalanceAfter).eq(0);

      expect(vaultBalanceBefore).eq(toAmountUint256(10));
      expect(vaultBalanceAfter).eq(toAmountUint256(10));

      expect(claimedBefore).eq(false);
      expect(claimedAfter).eq(false);
    });

    it("should not claim twice", async () => {
      const {router, vault, user, mpc, btcb} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to withdraw
      await btcb.transfer(vault.address, toAmountUint256(10));

      const txHash = "0xba5cd6f533e448e71786fdf5eeda4c3d47d6f616cb40b210cd9943f06677fe7e";

      const hash = utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["uint256", "address", "address", "uint256", "bytes32"],
          [network.config.chainId, user.address, btcb.address, toAmountUint256(1.1), txHash],
        ),
      );

      const signature = await mpc.signMessage(ethers.utils.arrayify(hash));

      await router
        .connect(user)
        .claim(user.address, user.address, btcb.address, toAmountUint256(1.1), txHash, signature);

      const userBalanceBefore = await btcb.balanceOf(user.address);
      const vaultBalanceBefore = await btcb.balanceOf(vault.address);
      const claimedBefore = await router.claimed(txHash);

      const tx = router
        .connect(user)
        .claim(user.address, user.address, btcb.address, toAmountUint256(1.1), txHash, signature);

      await expect(tx).to.be.revertedWith("Router: Dual is already claimed");

      const userBalanceAfter = await btcb.balanceOf(user.address);
      const vaultBalanceAfter = await btcb.balanceOf(vault.address);
      const claimedAfter = await router.claimed(txHash);

      expect(userBalanceBefore).eq(toAmountUint256(1.1));
      expect(userBalanceAfter).eq(toAmountUint256(1.1));

      expect(vaultBalanceBefore).eq(toAmountUint256(8.9));
      expect(vaultBalanceAfter).eq(toAmountUint256(8.9));

      expect(claimedBefore).eq(true);
      expect(claimedAfter).eq(true);
    });

    it("should not claim after cancel", async () => {
      const {router, vault, user, mpc, btcb} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to withdraw
      await btcb.transfer(vault.address, toAmountUint256(10));

      const txHash = "0xba5cd6f533e448e71786fdf5eeda4c3d47d6f616cb40b210cd9943f06677fe7e";

      const hash = utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["uint256", "address", "address", "uint256", "bytes32"],
          [network.config.chainId, user.address, btcb.address, toAmountUint256(1.1), txHash],
        ),
      );

      const signature = await mpc.signMessage(ethers.utils.arrayify(hash));

      await router.connect(mpc).cancel(user.address, btcb.address, toAmountUint256(1.1), txHash);

      const userBalanceBefore = await btcb.balanceOf(user.address);
      const vaultBalanceBefore = await btcb.balanceOf(vault.address);
      const claimedBefore = await router.claimed(txHash);

      const tx = router
        .connect(user)
        .claim(user.address, user.address, btcb.address, toAmountUint256(1.1), txHash, signature);

      await expect(tx).to.be.revertedWith("Router: Dual is already claimed");

      const userBalanceAfter = await btcb.balanceOf(user.address);
      const vaultBalanceAfter = await btcb.balanceOf(vault.address);
      const claimedAfter = await router.claimed(txHash);

      expect(userBalanceBefore).eq(toAmountUint256(1.1));
      expect(userBalanceAfter).eq(toAmountUint256(1.1));

      expect(vaultBalanceBefore).eq(toAmountUint256(8.9));
      expect(vaultBalanceAfter).eq(toAmountUint256(8.9));

      expect(claimedBefore).eq(true);
      expect(claimedAfter).eq(true);
    });

    it("should not claim w/ bad signature", async () => {
      const {router, vault, user, mpc, btcb} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to withdraw
      await btcb.transfer(vault.address, toAmountUint256(10));

      const txHash = "0xba5cd6f533e448e71786fdf5eeda4c3d47d6f616cb40b210cd9943f06677fe7e";

      const hash = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "address", "address", "uint256", "bytes32"],
        [network.config.chainId, user.address, btcb.address, toAmountUint256(2), txHash],
      );

      const signature1 = await mpc.signMessage(ethers.utils.arrayify(hash));
      const signature2 = await user.signMessage(ethers.utils.arrayify(hash));

      const userBalanceBefore = await btcb.balanceOf(user.address);
      const vaultBalanceBefore = await btcb.balanceOf(vault.address);
      const claimedBefore = await router.claimed(txHash);

      const tx1 = router
        .connect(user)
        .claim(user.address, user.address, btcb.address, toAmountUint256(4), txHash, signature1);

      const tx2 = router
        .connect(user)
        .claim(user.address, user.address, btcb.address, toAmountUint256(2), txHash, signature2);

      await expect(tx1).to.be.revertedWith("MPCSignable: Must be MPC");
      await expect(tx2).to.be.revertedWith("MPCSignable: Must be MPC");

      const userBalanceAfter = await btcb.balanceOf(user.address);
      const vaultBalanceAfter = await btcb.balanceOf(vault.address);
      const claimedAfter = await router.claimed(txHash);

      expect(userBalanceBefore).eq(0);
      expect(userBalanceAfter).eq(0);

      expect(vaultBalanceBefore).eq(toAmountUint256(10));
      expect(vaultBalanceAfter).eq(toAmountUint256(10));

      expect(claimedBefore).eq(false);
      expect(claimedAfter).eq(false);
    });

    it("should not claim w/ bad txHash", async () => {
      const {router, vault, user, mpc, btcb} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to withdraw
      await btcb.transfer(vault.address, toAmountUint256(10));

      const txHash = "0x0000000000000000000000000000000000000000000000000000000000000000";

      const hash = utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["uint256", "address", "address", "uint256", "bytes32"],
          [network.config.chainId, user.address, btcb.address, toAmountUint256(1.1), txHash],
        ),
      );

      const signature = await mpc.signMessage(ethers.utils.arrayify(hash));

      const userBalanceBefore = await btcb.balanceOf(user.address);
      const vaultBalanceBefore = await btcb.balanceOf(vault.address);
      const claimedBefore = await router.claimed(txHash);

      const tx = router
        .connect(user)
        .claim(user.address, user.address, btcb.address, toAmountUint256(1.1), txHash, signature);

      await expect(tx).to.be.revertedWith("Router: Bad transaction hash");

      const userBalanceAfter = await btcb.balanceOf(user.address);
      const vaultBalanceAfter = await btcb.balanceOf(vault.address);
      const claimedAfter = await router.claimed(txHash);

      expect(userBalanceBefore).eq(0);
      expect(userBalanceAfter).eq(0);

      expect(vaultBalanceBefore).eq(toAmountUint256(10));
      expect(vaultBalanceAfter).eq(toAmountUint256(10));

      expect(claimedBefore).eq(false);
      expect(claimedAfter).eq(false);
    });

    it("should not claim w/ bad amount", async () => {
      const {router, vault, user, mpc, btcb} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to withdraw
      await btcb.transfer(vault.address, toAmountUint256(10));

      const txHash = "0xba5cd6f533e448e71786fdf5eeda4c3d47d6f616cb40b210cd9943f06677fe7e";

      const hash = utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["uint256", "address", "address", "uint256", "bytes32"],
          [network.config.chainId, user.address, btcb.address, toAmountUint256(0), txHash],
        ),
      );

      const signature = await mpc.signMessage(ethers.utils.arrayify(hash));

      const userBalanceBefore = await btcb.balanceOf(user.address);
      const vaultBalanceBefore = await btcb.balanceOf(vault.address);
      const claimedBefore = await router.claimed(txHash);

      const tx = router
        .connect(user)
        .claim(user.address, user.address, btcb.address, toAmountUint256(0), txHash, signature);

      await expect(tx).to.be.revertedWith("Router: Too small output amount");

      const userBalanceAfter = await btcb.balanceOf(user.address);
      const vaultBalanceAfter = await btcb.balanceOf(vault.address);
      const claimedAfter = await router.claimed(txHash);

      expect(userBalanceBefore).eq(0);
      expect(userBalanceAfter).eq(0);

      expect(vaultBalanceBefore).eq(toAmountUint256(10));
      expect(vaultBalanceAfter).eq(toAmountUint256(10));

      expect(claimedBefore).eq(false);
      expect(claimedAfter).eq(false);
    });
  });

  describe("cancel()", () => {
    it("should cancel tokens", async () => {
      const {router, vault, user, mpc, usdt} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to withdraw
      await usdt.transfer(vault.address, 1000 * 1e6);

      const txHash = "0xba5cd6f533e448e71786fdf5eeda4c3d47d6f616cb40b210cd9943f06677fe7e";

      const userBalanceBefore = await usdt.balanceOf(user.address);
      const vaultBalanceBefore = await usdt.balanceOf(vault.address);
      const claimedBefore = await router.claimed(txHash);

      const tx = await router.connect(mpc).cancel(user.address, usdt.address, 100 * 1e6, txHash);
      const {status, events} = await tx.wait();
      const event1 = events?.[0] as any;
      const event2 = events?.[1] as any;

      const userBalanceAfter = await usdt.balanceOf(user.address);
      const vaultBalanceAfter = await usdt.balanceOf(vault.address);
      const claimedAfter = await router.claimed(txHash);

      expect(status).eq(1);
      expect(events).length(2);

      expect(event1.address).to.be.equal(usdt.address);
      expect(event1.topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Transfer(address,address,uint256)")),
        vault.address,
        user.address,
      ]);
      expect(parseInt(event1.data, 16)).to.be.equal(100 * 1e6);

      expect(event2.event).eq("DualCanceled");
      expect(event2.args).length(4);
      expect(event2.args[0]).eq(user.address);
      expect(event2.args[1]).eq(usdt.address);
      expect(event2.args[2].toNumber()).eq(100 * 1e6);
      expect(event2.args[3]).eq(txHash);

      expect(userBalanceBefore).eq(0);
      expect(userBalanceAfter).eq(100 * 1e6);

      expect(vaultBalanceBefore).eq(1000 * 1e6);
      expect(vaultBalanceAfter).eq(900 * 1e6);

      expect(claimedBefore).eq(false);
      expect(claimedAfter).eq(true);
    });

    it("should cancel eth", async () => {
      const {router, vault, user, mpc, weth} = await loadFixture(deploy);

      // top up vault to be sure here's enough funds to withdraw
      await vault.deposit({value: parseEther("100")});

      const txHash = "0xba5cd6f533e448e71786fdf5eeda4c3d47d6f616cb40b210cd9943f06677fe7e";

      const userValueBefore = await ethers.provider.getBalance(user.address);
      const vaultValueBefore = await ethers.provider.getBalance(vault.address);
      const claimedBefore = await router.claimed(txHash);

      const tx = await router.connect(mpc).cancel(user.address, weth.address, parseEther("1"), txHash);
      const {status, events} = await tx.wait();
      const event = events?.[0] as any;

      const userValueAfter = await ethers.provider.getBalance(user.address);
      const vaultValueAfter = await ethers.provider.getBalance(vault.address);
      const claimedAfter = await router.claimed(txHash);

      expect(status).eq(1);
      expect(events).length(1);

      expect(event.event).eq("DualCanceled");
      expect(event.args).length(4);
      expect(event.args[0]).eq(user.address);
      expect(event.args[1]).eq(weth.address);
      expect(event.args[2]).eq(parseEther("1"));
      expect(event.args[3]).eq(txHash);

      expect(userValueAfter.sub(userValueBefore)).eq(parseEther("1"));

      expect(vaultValueBefore).eq(parseEther("100"));
      expect(vaultValueAfter).eq(parseEther("99"));

      expect(claimedBefore).eq(false);
      expect(claimedAfter).eq(true);
    });

    it("should not cancel if not mpc", async () => {
      const {router, vault, user, usdt} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to withdraw
      await usdt.transfer(vault.address, 1000 * 1e6);

      const txHash = "0xba5cd6f533e448e71786fdf5eeda4c3d47d6f616cb40b210cd9943f06677fe7e";

      const userBalanceBefore = await usdt.balanceOf(user.address);
      const vaultBalanceBefore = await usdt.balanceOf(vault.address);
      const claimedBefore = await router.claimed(txHash);

      const tx = router.connect(user).cancel(user.address, usdt.address, 100 * 1e6, txHash);

      await expect(tx).to.be.revertedWith("MPCManageable: Non MPC");

      const userBalanceAfter = await usdt.balanceOf(user.address);
      const vaultBalanceAfter = await usdt.balanceOf(vault.address);
      const claimedAfter = await router.claimed(txHash);

      expect(userBalanceBefore).eq(0);
      expect(userBalanceAfter).eq(0);

      expect(vaultBalanceBefore).eq(1000 * 1e6);
      expect(vaultBalanceAfter).eq(1000 * 1e6);

      expect(claimedBefore).eq(false);
      expect(claimedAfter).eq(false);
    });

    it("should not cancel twice", async () => {
      const {router, vault, user, mpc, usdt} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to withdraw
      await usdt.transfer(vault.address, 1000 * 1e6);

      const txHash = "0xba5cd6f533e448e71786fdf5eeda4c3d47d6f616cb40b210cd9943f06677fe7e";

      await router.connect(mpc).cancel(user.address, usdt.address, 100 * 1e6, txHash);

      const userBalanceBefore = await usdt.balanceOf(user.address);
      const vaultBalanceBefore = await usdt.balanceOf(vault.address);
      const claimedBefore = await router.claimed(txHash);

      const tx = router.connect(mpc).cancel(user.address, usdt.address, 100 * 1e6, txHash);

      await expect(tx).to.be.revertedWith("Router: Dual is already claimed");

      const userBalanceAfter = await usdt.balanceOf(user.address);
      const vaultBalanceAfter = await usdt.balanceOf(vault.address);
      const claimedAfter = await router.claimed(txHash);

      expect(userBalanceBefore).eq(100 * 1e6);
      expect(userBalanceAfter).eq(100 * 1e6);

      expect(vaultBalanceBefore).eq(900 * 1e6);
      expect(vaultBalanceAfter).eq(900 * 1e6);

      expect(claimedBefore).eq(true);
      expect(claimedAfter).eq(true);
    });

    it("should not cancel after claim", async () => {
      const {router, vault, user, mpc, btcb} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to withdraw
      await btcb.transfer(vault.address, toAmountUint256(10));

      const txHash = "0xba5cd6f533e448e71786fdf5eeda4c3d47d6f616cb40b210cd9943f06677fe7e";

      const hash = utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["uint256", "address", "address", "uint256", "bytes32"],
          [network.config.chainId, user.address, btcb.address, toAmountUint256(1.5), txHash],
        ),
      );

      const signature = await mpc.signMessage(ethers.utils.arrayify(hash));

      await router
        .connect(mpc)
        .claim(user.address, user.address, btcb.address, toAmountUint256(1.5), txHash, signature);

      const userBalanceBefore = await btcb.balanceOf(user.address);
      const vaultBalanceBefore = await btcb.balanceOf(vault.address);
      const claimedBefore = await router.claimed(txHash);

      const tx = router.connect(mpc).cancel(user.address, btcb.address, toAmountUint256(1.5), txHash);

      await expect(tx).to.be.revertedWith("Router: Dual is already claimed");

      const userBalanceAfter = await btcb.balanceOf(user.address);
      const vaultBalanceAfter = await btcb.balanceOf(vault.address);
      const claimedAfter = await router.claimed(txHash);

      expect(userBalanceBefore).eq(toAmountUint256(1.5));
      expect(userBalanceAfter).eq(toAmountUint256(1.5));

      expect(vaultBalanceBefore).eq(toAmountUint256(8.5));
      expect(vaultBalanceAfter).eq(toAmountUint256(8.5));

      expect(claimedBefore).eq(true);
      expect(claimedAfter).eq(true);
    });

    it("should not cancel w/ bad amount", async () => {
      const {router, vault, user, mpc, usdt} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to withdraw
      await usdt.transfer(vault.address, 1000 * 1e6);

      const txHash = "0xba5cd6f533e448e71786fdf5eeda4c3d47d6f616cb40b210cd9943f06677fe7e";

      const userBalanceBefore = await usdt.balanceOf(user.address);
      const vaultBalanceBefore = await usdt.balanceOf(vault.address);
      const claimedBefore = await router.claimed(txHash);

      const tx = router.connect(mpc).cancel(user.address, usdt.address, 0, txHash);

      await expect(tx).to.be.revertedWith("Router: Too small input amount");

      const userBalanceAfter = await usdt.balanceOf(user.address);
      const vaultBalanceAfter = await usdt.balanceOf(vault.address);
      const claimedAfter = await router.claimed(txHash);

      expect(userBalanceBefore).eq(0);
      expect(userBalanceAfter).eq(0);

      expect(vaultBalanceBefore).eq(1000 * 1e6);
      expect(vaultBalanceAfter).eq(1000 * 1e6);

      expect(claimedBefore).eq(false);
      expect(claimedAfter).eq(false);
    });

    it("should not cancel w/ bad txHash", async () => {
      const {router, vault, user, mpc, usdt} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to withdraw
      await usdt.transfer(vault.address, 1000 * 1e6);

      const txHash = "0x0000000000000000000000000000000000000000000000000000000000000000";

      const userBalanceBefore = await usdt.balanceOf(user.address);
      const vaultBalanceBefore = await usdt.balanceOf(vault.address);
      const claimedBefore = await router.claimed(txHash);

      const tx = router.connect(mpc).cancel(user.address, usdt.address, 100 * 1e6, txHash);

      await expect(tx).to.be.revertedWith("Router: Bad transaction hash");

      const userBalanceAfter = await usdt.balanceOf(user.address);
      const vaultBalanceAfter = await usdt.balanceOf(vault.address);
      const claimedAfter = await router.claimed(txHash);

      expect(userBalanceBefore).eq(0);
      expect(userBalanceAfter).eq(0);

      expect(vaultBalanceBefore).eq(1000 * 1e6);
      expect(vaultBalanceAfter).eq(1000 * 1e6);

      expect(claimedBefore).eq(false);
      expect(claimedAfter).eq(false);
    });
  });
});
