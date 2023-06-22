import {expect} from "chai";
import {ethers, network} from "hardhat";
import {loadFixture, time} from "@nomicfoundation/hardhat-network-helpers";
import {Token, DualFactory} from "../typechain-types";
import {getId, toAmountUint256, toPriceUint256, toYieldUint256} from "./helpers/format";
import {dualFactory} from "./helpers/data";

describe("dual", () => {
  async function deploy() {
    const [, user, mpc] = await ethers.getSigners();

    // eslint-disable-next-line @typescript-eslint/no-shadow
    const Token = await ethers.getContractFactory("Token");

    const btcb = await Token.deploy("BTCB Token", "BTCB", 18);
    const usdt = await Token.deploy("Tether USD", "USDT", 6);
    const usdc = await Token.deploy("USD Coin", "USDC", 18);

    const Dual = await ethers.getContractFactory("DualFactory");
    const dual = await Dual.deploy(mpc.address);

    return {
      btcb: btcb as Token,
      usdt: usdt as Token,
      usdc: usdc as Token,

      dual: dual as DualFactory,

      user,
      mpc,
    };
  }

  before(async () => {
    await network.provider.request({
      method: "hardhat_reset",
    });
  });

  describe("updateMPC()", () => {
    it("should update mpc", async () => {
      const {dual, mpc} = await loadFixture(deploy);

      const tx = await dual.connect(mpc).updateMPC("0x1f7b0df2a23e5f98807cb5282017de7be67caddf");
      const now = await time.latest();
      const {status, events} = await tx.wait();
      const event = events?.[0] as any;

      const mpc1 = await dual.mpc();
      await time.increase(48 * 60 * 60);
      const mpc2 = await dual.mpc();

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
      const {dual, user} = await loadFixture(deploy);

      const tx = dual.connect(user).updateMPC("0x1f7b0df2a23e5f98807cb5282017de7be67caddf");

      await expect(tx).to.be.revertedWith("MPCManageable: Non MPC");
    });

    it("should not update mpc to zero address", async () => {
      const {dual, mpc} = await loadFixture(deploy);

      const tx = dual.connect(mpc).updateMPC(ethers.constants.AddressZero);

      await expect(tx).to.be.revertedWith("MPCManageable: Nullable MPC");
    });
  });

  describe("create()", () => {
    it("should create", async () => {
      const state = await loadFixture(deploy);
      const {dual, mpc} = state;

      const tariff = dualFactory.tariff(state);
      const input = dualFactory.input(state);
      const id = getId(dualFactory.dual(tariff, input));

      const finishAt = +input.startedAt + 24 * 60 * 60;

      const tx = await dual.connect(mpc).create(tariff, input);
      const exists = await dual.duals(id);
      const {status, events} = await tx.wait();
      const event = events?.[0] as any;

      expect(exists).eq(true);

      expect(status).eq(1);
      expect(events).length(1);

      expect(event.event).eq("DualCreated");
      expect(event.args).length(11);
      expect(event.args[0]).eq(id);
      expect(event.args[1]).eq(input.user);
      expect(event.args[2].toString()).eq(tariff.chainId.toString());
      expect(event.args[3].toString()).eq(input.parentId);
      expect(event.args[4]).eq(tariff.baseToken);
      expect(event.args[5]).eq(tariff.quoteToken);
      expect(event.args[6]).eq(input.token);
      expect(event.args[7].toString()).eq(input.amount);
      expect(event.args[8].toString()).eq(tariff.yield);
      expect(event.args[9].toString()).eq(input.initialPrice);
      expect(event.args[10].toString()).eq(finishAt.toString());
    });

    it("should not create if not mpc", async () => {
      const state = await loadFixture(deploy);
      const {dual, user} = state;

      const tariff = dualFactory.tariff(state);
      const input = dualFactory.input(state);

      const tx = dual.connect(user).create(tariff, input);

      await expect(tx).revertedWith("MPCManageable: Non MPC");
    });

    it("should not create if exists", async () => {
      const state = await loadFixture(deploy);
      const {dual, mpc} = state;

      const tariff = dualFactory.tariff(state);
      const input = dualFactory.input(state);

      const tx1 = await dual.connect(mpc).create(tariff, input);
      const receipt1 = await tx1.wait();

      const tx2 = dual.connect(mpc).create(tariff, input);

      expect(receipt1.status).eq(1);
      expect(receipt1.logs).length(1);

      await expect(tx2).revertedWith("Dual: Already created");
    });

    it("should not create w/ bad user", async () => {
      const state = await loadFixture(deploy);
      const {dual, mpc} = state;

      const tariff = dualFactory.tariff(state);
      const input = dualFactory.input(state);

      const tx = dual.connect(mpc).create(tariff, {
        ...input,
        user: ethers.constants.AddressZero,
      });

      await expect(tx).revertedWith("Dual: Bad user");
    });

    it("should not create w/ bad chainId", async () => {
      const state = await loadFixture(deploy);
      const {dual, mpc} = state;

      const tariff = dualFactory.tariff(state);
      const input = dualFactory.input(state);

      const tx = dual.connect(mpc).create(
        {
          ...tariff,
          chainId: 0,
        },
        input,
      );

      await expect(tx).revertedWith("Dual: Bad chainId");
    });

    it("should not create w/ bad inputToken", async () => {
      const state = await loadFixture(deploy);
      const {dual, mpc, usdc} = state;

      const tariff = dualFactory.tariff(state);
      const input = dualFactory.input(state);

      const tx = dual.connect(mpc).create(tariff, {
        ...input,
        token: usdc.address,
      });

      await expect(tx).revertedWith("Dual: Input must be one from pair");
    });

    it("should not create w/ bad inputAmount", async () => {
      const state = await loadFixture(deploy);
      const {dual, mpc} = state;

      const tariff = dualFactory.tariff(state);
      const input = dualFactory.input(state);

      const tx = dual.connect(mpc).create(tariff, {
        ...input,
        amount: toAmountUint256(0),
      });

      await expect(tx).revertedWith("Dual: Bad amount");
    });

    it("should not create w/ bad yield", async () => {
      const state = await loadFixture(deploy);
      const {dual, mpc} = state;

      const tariff = dualFactory.tariff(state);
      const input = dualFactory.input(state);

      const tx = dual.connect(mpc).create(
        {
          ...tariff,
          yield: toYieldUint256(0),
        },
        input,
      );

      await expect(tx).revertedWith("Dual: Bad tariff yield");
    });

    it("should not create w/ bad initialPrice", async () => {
      const state = await loadFixture(deploy);
      const {dual, mpc} = state;

      const tariff = dualFactory.tariff(state);
      const input = dualFactory.input(state);

      const tx = dual.connect(mpc).create(tariff, {
        ...input,
        initialPrice: toAmountUint256(0),
      });

      await expect(tx).revertedWith("Dual: Bad initialPrice");
    });

    it("should not create w/ bad stakingPeriod", async () => {
      const state = await loadFixture(deploy);
      const {dual, mpc} = state;

      const tariff = dualFactory.tariff(state);
      const input = dualFactory.input(state);

      const tx = dual.connect(mpc).create(
        {
          ...tariff,
          stakingPeriod: 0,
        },
        input,
      );

      await expect(tx).revertedWith("Dual: Bad tariff stakingPeriod");
    });

    it("should not create w/ bad parentId", async () => {
      const state = await loadFixture(deploy);
      const {dual, mpc} = state;

      const tariff = dualFactory.tariff(state);
      const input = dualFactory.input(state);

      const tx = dual.connect(mpc).create(tariff, {
        ...input,
        parentId: "0x0000000000000000000000000000000000000000000000000000000000000000",
      });

      await expect(tx).revertedWith("Dual: Bad parentId");
    });

    it("should not create w/ bad finishAt", async () => {
      const state = await loadFixture(deploy);
      const {dual, mpc} = state;

      const tariff = dualFactory.tariff(state);
      const input = dualFactory.input(state);

      const tx = dual.connect(mpc).create(tariff, {
        ...input,
        startedAt: Math.round((Date.now() - 1000 * 60 * 60 * 25) / 1000).toString(),
      });

      await expect(tx).revertedWith("Dual: Bad finish date");
    });
  });

  describe("claim()", () => {
    it("should claim w/ input = base & output = quote", async () => {
      const state = await loadFixture(deploy);
      const {dual, mpc, usdt} = state;

      const tariff = dualFactory.tariff(state);
      const input = dualFactory.input(state);
      const claimed = dualFactory.dualClaimed(tariff, input);

      const id = getId(claimed);
      const finishAt = +input.startedAt + 24 * 60 * 60;

      const tx1 = await dual.connect(mpc).create(tariff, input);
      const receipt1 = await tx1.wait();
      const event1 = receipt1.events?.[0] as any;
      const exists1 = await dual.duals(id);

      await time.increase(24 * 60 * 60);

      const tx2 = await dual.connect(mpc).claim(claimed);
      const receipt2 = await tx2.wait();
      const event2 = receipt2.events?.[0] as any;
      const exists2 = await dual.duals(id);

      const tx3 = dual.connect(mpc).claim(claimed);

      expect(receipt1.status).eq(1);
      expect(receipt1.events).length(1);

      expect(event1.event).eq("DualCreated");
      expect(event1.args).length(11);
      expect(event1.args[0]).eq(id);

      expect(receipt2.status).eq(1);
      expect(receipt2.events).length(1);

      await expect(tx3).to.be.revertedWith("Dual: Not found");

      expect(event2.event).eq("DualClaimed");
      expect(event2.args).length(8);
      expect(event2.args[0]).eq(id);
      expect(event2.args[1]).eq(input.user);
      expect(event2.args[2].toString()).eq(tariff.chainId.toString());
      expect(event2.args[3].toString()).eq(input.parentId);
      expect(event2.args[4]).eq(usdt.address);
      expect(event2.args[5].toString()).eq(toAmountUint256(30_300));
      expect(event2.args[6].toString()).eq(toPriceUint256(31_000));
      expect(event2.args[7].toString()).eq(finishAt.toString());

      expect(exists1).eq(true);
      expect(exists2).eq(false);
    });

    it("should claim w/ input = base & output = base", async () => {
      const state = await loadFixture(deploy);
      const {dual, mpc, btcb} = state;

      const tariff = dualFactory.tariff(state);
      const input = dualFactory.input(state);
      const claimed = dualFactory.dualClaimed(tariff, input);

      const id = getId(claimed);
      const finishAt = +input.startedAt + 24 * 60 * 60;

      await dual.connect(mpc).create(tariff, input);
      await time.increase(24 * 60 * 60);

      const exists1 = await dual.duals(id);

      const tx = await dual.connect(mpc).claim({
        ...claimed,
        closedPrice: toPriceUint256(29_000),
      });

      const receipt = await tx.wait();
      const event = receipt.events?.[0] as any;

      const exists2 = await dual.duals(id);

      expect(event.event).eq("DualClaimed");
      expect(event.args).length(8);
      expect(event.args[0]).eq(id);
      expect(event.args[1]).eq(input.user);
      expect(event.args[2].toString()).eq(tariff.chainId.toString());
      expect(event.args[3].toString()).eq(input.parentId);
      expect(event.args[4]).eq(btcb.address);
      expect(event.args[5].toString()).eq(toAmountUint256(1.01));
      expect(event.args[6].toString()).eq(toPriceUint256(29_000));
      expect(event.args[7].toString()).eq(finishAt.toString());

      expect(exists1).eq(true);
      expect(exists2).eq(false);
    });

    it("should claim w/ input = quote & output = quote", async () => {
      const state = await loadFixture(deploy);
      const {dual, mpc, usdt} = state;

      const tariff = dualFactory.tariff(state);

      const input = {
        ...dualFactory.input(state),
        token: usdt.address,
        amount: toAmountUint256(3000),
      };

      const claimed = dualFactory.dualClaimed(tariff, input);

      const id = getId(claimed);
      const finishAt = +input.startedAt + 24 * 60 * 60;

      await dual.connect(mpc).create(tariff, input);
      await time.increase(24 * 60 * 60);

      const exists1 = await dual.duals(id);

      const tx = await dual.connect(mpc).claim({
        ...claimed,
        closedPrice: toPriceUint256(31_000),
      });

      const receipt = await tx.wait();
      const event = receipt.events?.[0] as any;

      const exists2 = await dual.duals(id);

      expect(event.event).eq("DualClaimed");
      expect(event.args).length(8);
      expect(event.args[0]).eq(id);
      expect(event.args[1]).eq(input.user);
      expect(event.args[2].toString()).eq(tariff.chainId.toString());
      expect(event.args[3].toString()).eq(input.parentId);
      expect(event.args[4]).eq(usdt.address);
      expect(event.args[5].toString()).eq(toAmountUint256(3030));
      expect(event.args[6].toString()).eq(toPriceUint256(31_000));
      expect(event.args[7].toString()).eq(finishAt.toString());

      expect(exists1).eq(true);
      expect(exists2).eq(false);
    });

    it("should claim w/ input = quote & output = base", async () => {
      const state = await loadFixture(deploy);
      const {dual, mpc, usdt, btcb} = state;

      const tariff = dualFactory.tariff(state);

      const input = {
        ...dualFactory.input(state),
        token: usdt.address,
        amount: toAmountUint256(3000),
      };

      const claimed = dualFactory.dualClaimed(tariff, input);

      const id = getId(claimed);
      const finishAt = +input.startedAt + 24 * 60 * 60;

      await dual.connect(mpc).create(tariff, input);
      await time.increase(24 * 60 * 60);

      const exists1 = await dual.duals(id);

      const tx = await dual.connect(mpc).claim({
        ...claimed,
        closedPrice: toPriceUint256(29_000),
      });

      const receipt = await tx.wait();
      const event = receipt.events?.[0] as any;

      const exists2 = await dual.duals(id);

      expect(event.event).eq("DualClaimed");
      expect(event.args).length(8);
      expect(event.args[0]).eq(id);
      expect(event.args[1]).eq(input.user);
      expect(event.args[2].toString()).eq(tariff.chainId.toString());
      expect(event.args[3].toString()).eq(input.parentId);
      expect(event.args[4]).eq(btcb.address);
      expect(event.args[5].toString()).eq(toAmountUint256(0.101));
      expect(event.args[6].toString()).eq(toPriceUint256(29_000));
      expect(event.args[7].toString()).eq(finishAt.toString());

      expect(exists1).eq(true);
      expect(exists2).eq(false);
    });

    it("should not claim if not mpc", async () => {
      const state = await loadFixture(deploy);
      const {dual, mpc, user} = state;

      const tariff = dualFactory.tariff(state);
      const input = dualFactory.input(state);
      const claimed = dualFactory.dualClaimed(tariff, input);
      const id = getId(claimed);

      await dual.connect(mpc).create(tariff, input);

      const exists1 = await dual.duals(id);
      const tx = dual.connect(user).claim(claimed);
      const exists2 = await dual.duals(id);

      await expect(tx).revertedWith("MPCManageable: Non MPC");

      expect(exists1).eq(true);
      expect(exists2).eq(true);
    });

    it("should not claim if not found", async () => {
      const state = await loadFixture(deploy);
      const {dual, mpc} = state;

      const tariff = dualFactory.tariff(state);
      const input = dualFactory.input(state);
      const claimed = dualFactory.dualClaimed(tariff, input);
      const id = getId(claimed);

      const exists1 = await dual.duals(id);
      const tx = dual.connect(mpc).claim(claimed);
      const exists2 = await dual.duals(id);

      await expect(tx).revertedWith("Dual: Not found");

      expect(exists1).eq(false);
      expect(exists2).eq(false);
    });

    it("should not claim w/ bad closedPrice", async () => {
      const state = await loadFixture(deploy);
      const {dual, mpc} = state;

      const tariff = dualFactory.tariff(state);
      const input = dualFactory.input(state);

      const claimed = {
        ...dualFactory.dualClaimed(tariff, input),
        closedPrice: toPriceUint256(0),
      };

      const id = getId(claimed);

      await dual.connect(mpc).create(tariff, input);

      const exists1 = await dual.duals(id);
      const tx = dual.connect(mpc).claim(claimed);
      const exists2 = await dual.duals(id);

      await expect(tx).revertedWith("Dual: Bad closed price");

      expect(exists1).eq(true);
      expect(exists2).eq(true);
    });

    it("should not claim w/ bad finishAt", async () => {
      const state = await loadFixture(deploy);
      const {dual, mpc} = state;

      const tariff = dualFactory.tariff(state);
      const input = dualFactory.input(state);
      const claimed = dualFactory.dualClaimed(tariff, input);
      const id = getId(claimed);

      await dual.connect(mpc).create(tariff, input);

      // not finished yet, because the staking period is 24h
      await time.increase(23 * 60 * 60);

      const exists1 = await dual.duals(id);
      const tx = dual.connect(mpc).claim(claimed);
      const exists2 = await dual.duals(id);

      await expect(tx).revertedWith("Dual: Not finished yet");

      expect(exists1).eq(true);
      expect(exists2).eq(true);
    });
  });

  describe("replay()", () => {
    it("should replay", async () => {
      const state = await loadFixture(deploy);
      const {dual, mpc, usdt} = state;

      const tariff = dualFactory.tariff(state);
      const input = dualFactory.input(state);
      const claimed = dualFactory.dualClaimed(tariff, input);

      const id = getId(claimed);
      const finishAt = +input.startedAt + 24 * 60 * 60;

      const newInitialPrice = toPriceUint256(31_500);
      const newStartedAt = +input.startedAt + 25 * 60 * 60;
      const newFinishAt = newStartedAt + 24 * 60 * 60;

      const newId = getId({
        user: input.user,
        chainId: tariff.chainId,
        parentId: id,
        baseToken: tariff.baseToken,
        quoteToken: tariff.quoteToken,
        inputToken: usdt.address,
        inputAmount: toAmountUint256(30_300),
        yield: tariff.yield,
        initialPrice: newInitialPrice,
        finishAt: newFinishAt,
      });

      const tx1 = await dual.connect(mpc).create(tariff, input);
      const receipt1 = await tx1.wait();
      const event1 = receipt1.events?.[0] as any;
      const exists1 = await dual.duals(id);

      await time.increase(24 * 60 * 60);

      const tx2 = await dual.connect(mpc).replay(claimed, tariff, {
        initialPrice: newInitialPrice,
        startedAt: newStartedAt.toString(),
      });

      const receipt2 = await tx2.wait();
      const exists2 = await dual.duals(id);
      const event2Replayed = receipt2.events?.[0] as any;
      const event2Created = receipt2.events?.[1] as any;

      const tx3 = dual.connect(mpc).replay(claimed, tariff, {
        initialPrice: newInitialPrice,
        startedAt: newStartedAt.toString(),
      });

      const exists3 = await dual.duals(newId);

      // todo: event DualReplayed

      expect(receipt1.status).eq(1);
      expect(receipt1.events).length(1);

      expect(event1.event).eq("DualCreated");
      expect(event1.args).length(11);
      expect(event1.args[0]).eq(id);

      expect(receipt2.status).eq(1);
      expect(receipt2.events).length(2);

      await expect(tx3).to.be.revertedWith("Dual: Not found");

      expect(event2Replayed.event).eq("DualReplayed");
      expect(event2Replayed.args).length(8);
      expect(event2Replayed.args[0]).eq(id);
      expect(event2Replayed.args[1]).eq(input.user);
      expect(event2Replayed.args[2].toString()).eq(tariff.chainId.toString());
      expect(event2Replayed.args[3].toString()).eq(input.parentId);
      expect(event2Replayed.args[4]).eq(usdt.address);
      expect(event2Replayed.args[5].toString()).eq(toAmountUint256(30300));
      expect(event2Replayed.args[6].toString()).eq(toPriceUint256(31_000));
      expect(event2Replayed.args[7].toString()).eq(finishAt.toString());

      expect(event2Created.event).eq("DualCreated");
      expect(event2Created.args).length(11);
      expect(event2Created.args[0]).eq(newId);
      expect(event2Created.args[1]).eq(input.user);
      expect(event2Created.args[2].toString()).eq(tariff.chainId.toString());
      expect(event2Created.args[3].toString()).eq(id);
      expect(event2Created.args[4]).eq(tariff.baseToken);
      expect(event2Created.args[5]).eq(tariff.quoteToken);
      expect(event2Created.args[6]).eq(usdt.address);
      expect(event2Created.args[7].toString()).eq(toAmountUint256(30_300));
      expect(event2Created.args[8].toString()).eq(tariff.yield);
      expect(event2Created.args[9].toString()).eq(newInitialPrice);
      expect(event2Created.args[10].toString()).eq(newFinishAt.toString());

      expect(exists1).eq(true);
      expect(exists2).eq(false);
      expect(exists3).eq(true);
    });

    it("should replay w/ updated tariff", async () => {
      const state = await loadFixture(deploy);
      const {dual, mpc, btcb} = state;

      const tariff = dualFactory.tariff(state);

      const input = dualFactory.input(state);

      const claimed = {
        ...dualFactory.dualClaimed(tariff, input),
        closedPrice: toPriceUint256(25_000),
      };

      const id = getId(claimed);
      const finishAt = +input.startedAt + 24 * 60 * 60;

      const newInitialPrice = toPriceUint256(25_500);
      const newStartedAt = +input.startedAt + 48 * 60 * 60;
      const newFinishAt = newStartedAt + 12 * 60 * 60;

      const newId = getId({
        user: input.user,
        chainId: tariff.chainId,
        parentId: id,
        baseToken: tariff.baseToken,
        quoteToken: tariff.quoteToken,
        inputToken: btcb.address,
        inputAmount: toAmountUint256(1.01),
        yield: tariff.yield,
        initialPrice: newInitialPrice,
        finishAt: newFinishAt,
      });

      const tx1 = await dual.connect(mpc).create(tariff, input);
      const receipt1 = await tx1.wait();
      const event1 = receipt1.events?.[0] as any;
      const exists1 = await dual.duals(id);

      await time.increase(24 * 60 * 60);

      const tx2 = await dual.connect(mpc).replay(
        claimed,
        {
          ...tariff,
          stakingPeriod: 12,
        },
        {
          initialPrice: newInitialPrice,
          startedAt: newStartedAt.toString(),
        },
      );

      const receipt2 = await tx2.wait();
      const event2Replayed = receipt2.events?.[0] as any;
      const event2Created = receipt2.events?.[1] as any;

      const exists2 = await dual.duals(id);
      const exists3 = await dual.duals(newId);

      expect(receipt1.status).eq(1);
      expect(receipt1.events).length(1);

      expect(event1.event).eq("DualCreated");
      expect(event1.args).length(11);
      expect(event1.args[0]).eq(id);

      expect(event2Replayed.event).eq("DualReplayed");
      expect(event2Replayed.args).length(8);
      expect(event2Replayed.args[0]).eq(id);
      expect(event2Replayed.args[1]).eq(input.user);
      expect(event2Replayed.args[2].toString()).eq(tariff.chainId.toString());
      expect(event2Replayed.args[3].toString()).eq(input.parentId);
      expect(event2Replayed.args[4]).eq(btcb.address);
      expect(event2Replayed.args[5].toString()).eq(toAmountUint256(1.01));
      expect(event2Replayed.args[6].toString()).eq(toPriceUint256(25_000));
      expect(event2Replayed.args[7].toString()).eq(finishAt.toString());

      expect(event2Created.event).eq("DualCreated");
      expect(event2Created.args).length(11);
      expect(event2Created.args[0]).eq(newId);
      expect(event2Created.args[1]).eq(input.user);
      expect(event2Created.args[2].toString()).eq(tariff.chainId.toString());
      expect(event2Created.args[3].toString()).eq(id);
      expect(event2Created.args[4]).eq(tariff.baseToken);
      expect(event2Created.args[5]).eq(tariff.quoteToken);
      expect(event2Created.args[6]).eq(btcb.address);
      expect(event2Created.args[7].toString()).eq(toAmountUint256(1.01));
      expect(event2Created.args[8].toString()).eq(tariff.yield);
      expect(event2Created.args[9].toString()).eq(newInitialPrice);
      expect(event2Created.args[10].toString()).eq(newFinishAt.toString());

      expect(exists1).eq(true);
      expect(exists2).eq(false);
      expect(exists3).eq(true);
    });

    it("should not replay if not mpc", async () => {
      const state = await loadFixture(deploy);
      const {dual, mpc, user} = state;

      const tariff = dualFactory.tariff(state);
      const input = dualFactory.input(state);
      const claimed = dualFactory.dualClaimed(tariff, input);
      const id = getId(claimed);

      await dual.connect(mpc).create(tariff, input);
      await time.increase(24 * 60 * 60);

      const exists1 = await dual.duals(id);

      const tx = dual.connect(user).replay(claimed, tariff, {
        initialPrice: toPriceUint256(31_000),
        startedAt: Math.round(Date.now() / 1000).toString(),
      });

      const exists2 = await dual.duals(id);

      await expect(tx).revertedWith("MPCManageable: Non MPC");

      expect(exists1).eq(true);
      expect(exists2).eq(true);
    });

    it("should not replay if not found", async () => {
      const state = await loadFixture(deploy);
      const {dual, mpc} = state;

      const tariff = dualFactory.tariff(state);
      const input = dualFactory.input(state);
      const claimed = dualFactory.dualClaimed(tariff, input);
      const id = getId(claimed);

      const exists1 = await dual.duals(id);

      const newInitialPrice = toPriceUint256(31_000);
      const newStartedAt = +input.startedAt + 25 * 60 * 60;

      const tx = dual.connect(mpc).replay(claimed, tariff, {
        initialPrice: newInitialPrice,
        startedAt: newStartedAt.toString(),
      });

      const exists2 = await dual.duals(id);

      await expect(tx).revertedWith("Dual: Not found");

      expect(exists1).eq(false);
      expect(exists2).eq(false);
    });

    it("should not replay w/ bad chainId", async () => {
      const state = await loadFixture(deploy);
      const {dual, mpc} = state;

      const tariff = dualFactory.tariff(state);
      const input = dualFactory.input(state);
      const claimed = dualFactory.dualClaimed(tariff, input);
      const id = getId(claimed);

      await dual.connect(mpc).create(tariff, input);
      await time.increase(24 * 60 * 60);

      const exists1 = await dual.duals(id);

      const newInitialPrice = toPriceUint256(31_000);
      const newStartedAt = +input.startedAt + 25 * 60 * 60;

      const tx = dual.connect(mpc).replay(
        claimed,
        {
          ...tariff,
          chainId: 0,
        },
        {
          initialPrice: newInitialPrice,
          startedAt: newStartedAt.toString(),
        },
      );

      const exists2 = await dual.duals(id);

      await expect(tx).revertedWith("Dual: Bad chainId");

      expect(exists1).eq(true);
      expect(exists2).eq(true);
    });

    it("should not replay w/ bad yield", async () => {
      const state = await loadFixture(deploy);
      const {dual, mpc} = state;

      const tariff = dualFactory.tariff(state);
      const input = dualFactory.input(state);
      const claimed = dualFactory.dualClaimed(tariff, input);
      const id = getId(claimed);

      await dual.connect(mpc).create(tariff, input);
      await time.increase(24 * 60 * 60);

      const exists1 = await dual.duals(id);

      const newInitialPrice = toPriceUint256(31_000);
      const newStartedAt = +input.startedAt + 25 * 60 * 60;

      const tx = dual.connect(mpc).replay(
        claimed,
        {
          ...tariff,
          yield: 0,
        },
        {
          initialPrice: newInitialPrice,
          startedAt: newStartedAt.toString(),
        },
      );

      const exists2 = await dual.duals(id);

      await expect(tx).revertedWith("Dual: Bad tariff yield");

      expect(exists1).eq(true);
      expect(exists2).eq(true);
    });

    it("should not replay w/ bad stakingPeriod", async () => {
      const state = await loadFixture(deploy);
      const {dual, mpc} = state;

      const tariff = dualFactory.tariff(state);
      const input = dualFactory.input(state);
      const claimed = dualFactory.dualClaimed(tariff, input);
      const id = getId(claimed);

      await dual.connect(mpc).create(tariff, input);
      await time.increase(24 * 60 * 60);

      const exists1 = await dual.duals(id);

      const newInitialPrice = toPriceUint256(31_000);
      const newStartedAt = +input.startedAt + 25 * 60 * 60;

      const tx = dual.connect(mpc).replay(
        claimed,
        {
          ...tariff,
          stakingPeriod: 0,
        },
        {
          initialPrice: newInitialPrice,
          startedAt: newStartedAt.toString(),
        },
      );

      const exists2 = await dual.duals(id);

      await expect(tx).revertedWith("Dual: Bad tariff stakingPeriod");

      expect(exists1).eq(true);
      expect(exists2).eq(true);
    });

    it("should not replay w/ bad closedPrice", async () => {
      const state = await loadFixture(deploy);
      const {dual, mpc} = state;

      const tariff = dualFactory.tariff(state);
      const input = dualFactory.input(state);
      const claimed = dualFactory.dualClaimed(tariff, input);
      const id = getId(claimed);

      await dual.connect(mpc).create(tariff, input);
      await time.increase(24 * 60 * 60);

      const exists1 = await dual.duals(id);

      const newInitialPrice = toPriceUint256(31_000);
      const newStartedAt = +input.startedAt + 25 * 60 * 60;

      const tx = dual.connect(mpc).replay(
        {
          ...claimed,
          closedPrice: toPriceUint256(0),
        },
        tariff,
        {
          initialPrice: newInitialPrice,
          startedAt: newStartedAt.toString(),
        },
      );

      const exists2 = await dual.duals(id);

      await expect(tx).revertedWith("Dual: Bad closed price");

      expect(exists1).eq(true);
      expect(exists2).eq(true);
    });

    it("should not replay w/ bad initialPrice", async () => {
      const state = await loadFixture(deploy);
      const {dual, mpc} = state;

      const tariff = dualFactory.tariff(state);
      const input = dualFactory.input(state);
      const claimed = dualFactory.dualClaimed(tariff, input);
      const id = getId(claimed);

      await dual.connect(mpc).create(tariff, input);
      await time.increase(24 * 60 * 60);

      const exists1 = await dual.duals(id);

      const newInitialPrice = toPriceUint256(0);
      const newStartedAt = +input.startedAt + 25 * 60 * 60;

      const tx = dual.connect(mpc).replay(claimed, tariff, {
        initialPrice: newInitialPrice,
        startedAt: newStartedAt.toString(),
      });

      const exists2 = await dual.duals(id);

      await expect(tx).revertedWith("Dual: Bad initialPrice");

      expect(exists1).eq(true);
      expect(exists2).eq(true);
    });

    it("should not replay w/ bad finishAt", async () => {
      const state = await loadFixture(deploy);
      const {dual, mpc} = state;

      const tariff = dualFactory.tariff(state);
      const input = dualFactory.input(state);
      const claimed = dualFactory.dualClaimed(tariff, input);
      const id = getId(claimed);

      await dual.connect(mpc).create(tariff, input);

      // not finished yet, because the staking period is 24h
      await time.increase(23 * 60 * 60);

      const exists1 = await dual.duals(id);

      const newInitialPrice = toPriceUint256(31_000);
      const newStartedAt = +input.startedAt + 25 * 60 * 60;

      const tx = dual.connect(mpc).replay(claimed, tariff, {
        initialPrice: newInitialPrice,
        startedAt: newStartedAt.toString(),
      });

      const exists2 = await dual.duals(id);

      await expect(tx).revertedWith("Dual: Not finished yet");

      expect(exists1).eq(true);
      expect(exists2).eq(true);
    });

    it("should not replay w/ bad startedAt", async () => {
      const state = await loadFixture(deploy);
      const {dual, mpc} = state;

      const tariff = dualFactory.tariff(state);
      const input = dualFactory.input(state);
      const claimed = dualFactory.dualClaimed(tariff, input);
      const id = getId(claimed);

      await dual.connect(mpc).create(tariff, input);
      await time.increase(24 * 60 * 60);

      const exists1 = await dual.duals(id);

      const newInitialPrice = toPriceUint256(31_000);
      const newStartedAt = +input.startedAt + 23 * 60 * 60;

      const tx = dual.connect(mpc).replay(claimed, tariff, {
        initialPrice: newInitialPrice,
        startedAt: newStartedAt.toString(),
      });

      const exists2 = await dual.duals(id);

      await expect(tx).revertedWith("Dual: Bad start date");

      expect(exists1).eq(true);
      expect(exists2).eq(true);
    });
  });
});
