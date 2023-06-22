import {expect} from "chai";
import {ethers, network} from "hardhat";
import {time, loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {parseEther} from "ethers/lib/utils";
import {Token, WETH} from "../typechain-types";
import {getPermit} from "./helpers/permit";

describe("vault", () => {
  async function deploy() {
    const [operator, user, mpc] = await ethers.getSigners();

    // eslint-disable-next-line @typescript-eslint/no-shadow
    const Token = await ethers.getContractFactory("Token");
    const usdt = await Token.deploy("Tether USD", "USDT", 6);

    const PayableContract = await ethers.getContractFactory("PayableContract");
    const payableContract = await PayableContract.deploy(user.address);

    // eslint-disable-next-line @typescript-eslint/no-shadow
    const WETH = await ethers.getContractFactory("WETH");
    const weth = await WETH.deploy();

    const Vault = await ethers.getContractFactory("Vault");
    const vault = await Vault.deploy(weth.address, mpc.address);

    return {
      usdt: usdt as Token,
      weth: weth as WETH,

      payableContract,
      vault,

      operator,
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
      const {vault, mpc} = await loadFixture(deploy);

      const tx = await vault.connect(mpc).updateMPC("0x1f7b0df2a23e5f98807cb5282017de7be67caddf");
      const now = await time.latest();
      const {status, events} = await tx.wait();
      const event = events?.[0] as any;

      const mpc1 = await vault.mpc();
      await time.increase(48 * 60 * 60);
      const mpc2 = await vault.mpc();

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
      const {vault, user} = await loadFixture(deploy);

      const tx = vault.connect(user).updateMPC("0x1f7b0df2a23e5f98807cb5282017de7be67caddf");

      await expect(tx).to.be.revertedWith("MPCManageable: Non MPC");
    });

    it("should not update mpc to zero address", async () => {
      const {vault, mpc} = await loadFixture(deploy);

      const tx = vault.connect(mpc).updateMPC(ethers.constants.AddressZero);

      await expect(tx).to.be.revertedWith("MPCManageable: Nullable MPC");
    });
  });

  describe("initOperators()", () => {
    it("should init operators", async () => {
      const {vault, operator, mpc} = await loadFixture(deploy);

      const initializedBefore = await vault.initialized();
      const operatorEffectiveTimeBefore = await vault.operators(operator.address);

      const tx = await vault.connect(mpc).initOperators([operator.address]);
      const now = await time.latest();

      const initializedAfter = await vault.initialized();
      const operatorEffectiveTimeAfter = await vault.operators(operator.address);

      const {status, events} = await tx.wait();
      const event1 = events?.[0] as any;
      const event2 = events?.[1] as any;

      expect(status).eq(1);
      expect(events).length(2);

      expect(event1.event).eq("OperatorAdded");
      expect(event1.args).length(2);
      expect(event1.args[0]).eq(operator.address);
      expect(event1.args[1].toNumber()).eq(now);

      expect(event2.event).eq("Initialized");
      expect(event2.args).length(0);

      expect(initializedBefore).eq(false);
      expect(initializedAfter).eq(true);

      expect(operatorEffectiveTimeBefore.toNumber()).eq(0);
      expect(operatorEffectiveTimeAfter.toNumber()).eq(now);
    });

    it("should not init operators if not mpc", async () => {
      const {vault, operator, user} = await loadFixture(deploy);

      const initializedBefore = await vault.initialized();
      const operatorEffectiveTimeBefore = await vault.operators(operator.address);
      const tx = vault.connect(user).initOperators([operator.address]);

      await expect(tx).to.be.revertedWith("MPCManageable: Non MPC");

      const initializedAfter = await vault.initialized();
      const operatorEffectiveTimeAfter = await vault.operators(operator.address);

      expect(initializedBefore).eq(false);
      expect(initializedAfter).eq(false);

      expect(operatorEffectiveTimeBefore).eq(0);
      expect(operatorEffectiveTimeAfter).eq(0);
    });

    it("should not init operators w/ empty array", async () => {
      const {vault, mpc} = await loadFixture(deploy);

      const initializedBefore = await vault.initialized();
      const tx = vault.connect(mpc).initOperators([]);

      await expect(tx).to.be.revertedWith("MPCOperable: Empty operators");

      const initializedAfter = await vault.initialized();

      expect(initializedBefore).eq(false);
      expect(initializedAfter).eq(false);
    });

    it("should not init operators w/ zero address", async () => {
      const {vault, operator, mpc} = await loadFixture(deploy);

      const initializedBefore = await vault.initialized();
      const tx = vault.connect(mpc).initOperators([operator.address, ethers.constants.AddressZero]);

      await expect(tx).to.be.revertedWith("MPCOperable: Nullable operator");

      const initializedAfter = await vault.initialized();
      const operatorEffectiveTime1 = await vault.operators(operator.address);
      const operatorEffectiveTime2 = await vault.operators(ethers.constants.AddressZero);

      expect(initializedBefore).eq(false);
      expect(initializedAfter).eq(false);

      expect(operatorEffectiveTime1).eq(0);
      expect(operatorEffectiveTime2).eq(0);
    });

    it("should not init operators twice", async () => {
      const {vault, operator, mpc} = await loadFixture(deploy);

      await vault.connect(mpc).initOperators([operator.address]);

      const tx = vault.connect(mpc).initOperators(["0x1f7b0df2a23e5f98807cb5282017de7be67caddf"]);

      await expect(tx).to.be.revertedWith("MPCOperable: Already initialized");

      const operatorEffectiveTime1 = await vault.operators(operator.address);
      const operatorEffectiveTime2 = await vault.operators("0x1f7b0df2a23e5f98807cb5282017de7be67caddf");

      expect(operatorEffectiveTime1).not.eq(0);
      expect(operatorEffectiveTime2).eq(0);
    });
  });

  describe("addOperator()", () => {
    it("should add operator", async () => {
      const {vault, operator, mpc} = await loadFixture(deploy);

      const operatorEffectiveTimeBefore = await vault.operators(operator.address);

      const tx = await vault.connect(mpc).addOperator(operator.address);
      const now = await time.latest();
      const {status, events} = await tx.wait();
      const event = events?.[0] as any;

      const operatorEffectiveTimeAfter = await vault.operators(operator.address);

      expect(status).eq(1);
      expect(events).length(1);

      expect(event.event).eq("OperatorAdded");
      expect(event.args[0]).eq(operator.address);
      expect(event.args[1].toNumber()).eq(now + 48 * 60 * 60);

      expect(operatorEffectiveTimeBefore).eq(0);
      expect(operatorEffectiveTimeAfter).eq(now + 48 * 60 * 60);
    });

    it("should not add operator if not mpc", async () => {
      const {vault, operator, user} = await loadFixture(deploy);

      const operatorEffectiveTimeBefore = await vault.operators(operator.address);
      const tx = vault.connect(user).addOperator(operator.address);

      await expect(tx).to.be.revertedWith("MPCManageable: Non MPC");

      const operatorEffectiveTimeAfter = await vault.operators(operator.address);

      expect(operatorEffectiveTimeBefore).eq(0);
      expect(operatorEffectiveTimeAfter).eq(0);
    });

    it("should not add operator if exists", async () => {
      const {vault, operator, mpc} = await loadFixture(deploy);

      await vault.connect(mpc).addOperator(operator.address);

      const operatorEffectiveTimeBefore = await vault.operators(operator.address);
      const tx = vault.connect(mpc).addOperator(operator.address);

      await expect(tx).to.be.revertedWith("MPCOperable: Operator exists");

      const operatorEffectiveTimeAfter = await vault.operators(operator.address);

      expect(operatorEffectiveTimeBefore).eq(operatorEffectiveTimeAfter);
    });

    it("should not add operator w/ zero address", async () => {
      const {vault, mpc} = await loadFixture(deploy);

      const operatorEffectiveTimeBefore = await vault.operators(ethers.constants.AddressZero);
      const tx = vault.connect(mpc).addOperator(ethers.constants.AddressZero);

      await expect(tx).to.be.revertedWith("MPCOperable: Nullable operator");

      const operatorEffectiveTimeAfter = await vault.operators(ethers.constants.AddressZero);

      expect(operatorEffectiveTimeBefore).eq(0);
      expect(operatorEffectiveTimeAfter).eq(0);
    });
  });

  describe("removeOperator()", () => {
    it("should remove operator", async () => {
      const {vault, operator, mpc} = await loadFixture(deploy);

      await vault.connect(mpc).addOperator(operator.address);

      const operatorEffectiveTimeBefore = await vault.operators(operator.address);

      const tx = await vault.connect(mpc).removeOperator(operator.address);
      const {status, events} = await tx.wait();
      const event = events?.[0] as any;

      const operatorEffectiveTimeAfter = await vault.operators(operator.address);

      expect(status).eq(1);
      expect(events).length(1);

      expect(event.event).eq("OperatorRemoved");
      expect(event.args).length(1);
      expect(event.args[0]).eq(operator.address);

      expect(operatorEffectiveTimeBefore).not.eq(0);
      expect(operatorEffectiveTimeAfter).eq(0);
    });

    it("should not remove operator if not mpc", async () => {
      const {vault, operator, user, mpc} = await loadFixture(deploy);

      await vault.connect(mpc).addOperator(operator.address);

      const operatorEffectiveTimeBefore = await vault.operators(operator.address);
      const tx = vault.connect(user).removeOperator(operator.address);

      await expect(tx).to.be.revertedWith("MPCManageable: Non MPC");

      const operatorEffectiveTimeAfter = await vault.operators(operator.address);

      expect(operatorEffectiveTimeBefore).eq(operatorEffectiveTimeAfter);
    });

    it("should not remove operator if not exists", async () => {
      const {vault, operator, mpc} = await loadFixture(deploy);

      const operatorEffectiveTimeBefore = await vault.operators(operator.address);
      const tx = vault.connect(mpc).removeOperator(operator.address);

      await expect(tx).to.be.revertedWith("MPCOperable: Operator doesn't exist");

      const operatorEffectiveTimeAfter = await vault.operators(operator.address);

      expect(operatorEffectiveTimeBefore).eq(0);
      expect(operatorEffectiveTimeAfter).eq(0);
    });
  });

  describe("deposit()", () => {
    it("should deposit", async () => {
      const {vault, mpc, user} = await loadFixture(deploy);

      const userValueBefore = await ethers.provider.getBalance(user.address);
      const mpcValueBefore = await ethers.provider.getBalance(mpc.address);
      const vaultValueBefore = await ethers.provider.getBalance(vault.address);

      const tx = await vault.connect(user).deposit({value: parseEther("1")});
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);

      const userValueAfter = await ethers.provider.getBalance(user.address);
      const mpcValueAfter = await ethers.provider.getBalance(mpc.address);
      const vaultValueAfter = await ethers.provider.getBalance(vault.address);

      expect(userValueAfter.add(gasUsed).sub(userValueBefore)).eq(parseEther("-1"));

      expect(mpcValueBefore).eq(mpcValueAfter);

      expect(vaultValueBefore).to.be.equal(0);
      expect(vaultValueAfter).to.be.equal(parseEther("1"));
    });
  });

  describe("depositToMPC()", () => {
    it("should deposit to mpc", async () => {
      const {vault, mpc, user} = await loadFixture(deploy);

      const userValueBefore = await ethers.provider.getBalance(user.address);
      const mpcValueBefore = await ethers.provider.getBalance(mpc.address);
      const vaultValueBefore = await ethers.provider.getBalance(vault.address);

      const tx = await vault.connect(user).depositToMPC({value: parseEther("1")});
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);

      const userValueAfter = await ethers.provider.getBalance(user.address);
      const mpcValueAfter = await ethers.provider.getBalance(mpc.address);
      const vaultValueAfter = await ethers.provider.getBalance(vault.address);

      expect(userValueAfter.add(gasUsed).sub(userValueBefore)).eq(parseEther("-1"));

      expect(mpcValueAfter.sub(mpcValueBefore)).eq(parseEther("1"));

      expect(vaultValueBefore).to.be.equal(0);
      expect(vaultValueAfter).to.be.equal(0);
    });
  });

  describe("depositTokens()", () => {
    it("should deposit tokens", async () => {
      const {vault, user, mpc, usdt} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to withdraw
      await usdt.transfer(user.address, 100 * 1e6);
      await usdt.connect(user).approve(vault.address, 100 * 1e6);

      const userBalanceBefore = await usdt.balanceOf(user.address);
      const vaultBalanceBefore = await usdt.balanceOf(vault.address);

      const tx = await vault.connect(mpc).depositTokens(user.address, usdt.address, 50 * 1e6);
      const receipt = await tx.wait();

      const userBalanceAfter = await usdt.balanceOf(user.address);
      const vaultBalanceAfter = await usdt.balanceOf(vault.address);

      expect(vaultBalanceBefore).to.be.equal(0);
      expect(vaultBalanceAfter).to.be.equal(50 * 1e6);

      expect(userBalanceBefore).to.be.equal(100 * 1e6);
      expect(userBalanceAfter).to.be.equal(50 * 1e6);

      expect(receipt.status).eq(1);
      expect(receipt.events).length(2);

      expect(receipt.events[0].address).to.be.equal(usdt.address);
      expect(receipt.events[0].topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Approval(address,address,uint256)")),
        user.address,
        vault.address,
      ]);
      expect(parseInt(receipt.events[0].data, 16)).to.be.equal(50 * 1e6);

      expect(receipt.events[1].address).to.be.equal(usdt.address);
      expect(receipt.events[1].topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Transfer(address,address,uint256)")),
        user.address,
        vault.address,
      ]);
      expect(parseInt(receipt.events[1].data, 16)).to.be.equal(50 * 1e6);
    });

    it("should deposit tokens w/ unwrap weth", async () => {
      const {vault, user, mpc, weth} = await loadFixture(deploy);

      await weth.connect(user).deposit({value: parseEther("1")});
      await weth.connect(user).approve(vault.address, parseEther("1"));

      const userBalanceBefore = await weth.balanceOf(user.address);
      const vaultBalanceBefore = await weth.balanceOf(vault.address);
      const vaultValueBefore = await ethers.provider.getBalance(vault.address);
      const mpcBalanceBefore = await weth.balanceOf(mpc.address);
      const mpcValueBefore = await ethers.provider.getBalance(mpc.address);

      const tx = await vault.connect(mpc).depositTokens(user.address, weth.address, parseEther("1"));
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);

      const userBalanceAfter = await weth.balanceOf(user.address);
      const vaultBalanceAfter = await weth.balanceOf(vault.address);
      const vaultValueAfter = await ethers.provider.getBalance(vault.address);
      const mpcBalanceAfter = await weth.balanceOf(mpc.address);
      const mpcValueAfter = await ethers.provider.getBalance(mpc.address);

      expect(userBalanceBefore).to.be.equal(parseEther("1"));
      expect(userBalanceAfter).to.be.equal(0);

      expect(vaultBalanceBefore).to.be.equal(0);
      expect(vaultBalanceAfter).to.be.equal(0);

      expect(vaultValueBefore).to.be.equal(0);
      expect(vaultValueAfter).to.be.equal(parseEther("1"));

      expect(mpcBalanceBefore).eq(0);
      expect(mpcBalanceAfter).eq(0);

      expect(mpcValueAfter.add(gasUsed).sub(mpcValueBefore)).eq(0);

      expect(receipt.status).eq(1);
      expect(receipt.events).length(2);

      expect(receipt.events[0].address).to.be.equal(weth.address);
      expect(receipt.events[0].topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Transfer(address,address,uint256)")),
        user.address,
        vault.address,
      ]);
      expect(parseInt(receipt.events[0].data, 16)).to.be.equal(1e18);

      expect(receipt.events[1].address).to.be.equal(weth.address);
      expect(receipt.events[1].topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Withdrawal(address,uint256)")),
        vault.address,
      ]);
      expect(parseInt(receipt.events[0].data, 16)).to.be.equal(1e18);
    });

    it("should not deposit tokens if has no access", async () => {
      const {vault, user, usdt} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to withdraw
      await usdt.transfer(user.address, 100 * 1e6);

      const userBalanceBefore = await usdt.balanceOf(user.address);
      const vaultBalanceBefore = await usdt.balanceOf(vault.address);

      const tx = vault.connect(user).depositTokens(user.address, usdt.address, 50 * 1e6);

      await expect(tx).to.be.revertedWith("MPCOperable: Must be MPC or operator");

      const userBalanceAfter = await usdt.balanceOf(user.address);
      const vaultBalanceAfter = await usdt.balanceOf(vault.address);

      expect(userBalanceBefore).to.be.equal(100 * 1e6);
      expect(vaultBalanceBefore).to.be.equal(0);

      expect(userBalanceAfter).to.be.equal(100 * 1e6);
      expect(vaultBalanceAfter).to.be.equal(0);
    });

    it("should not deposit tokens if has not enough allowance", async () => {
      const {vault, user, usdt, mpc} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to withdraw
      await usdt.transfer(user.address, 1000 * 1e6);
      await usdt.connect(user).approve(vault.address, 100 * 1e6);

      const userBalanceBefore = await usdt.balanceOf(user.address);
      const vaultBalanceBefore = await usdt.balanceOf(vault.address);

      const tx = vault.connect(mpc).depositTokens(user.address, usdt.address, 1000 * 1e6);

      await expect(tx).to.be.revertedWith("ERC20: insufficient allowance");

      const userBalanceAfter = await usdt.balanceOf(user.address);
      const vaultBalanceAfter = await usdt.balanceOf(vault.address);

      expect(userBalanceBefore).to.be.equal(1000 * 1e6);
      expect(vaultBalanceBefore).to.be.equal(0);

      expect(userBalanceAfter).to.be.equal(1000 * 1e6);
      expect(vaultBalanceAfter).to.be.equal(0);
    });

    it("should not deposit tokens if has not enough funds", async () => {
      const {vault, user, usdt, mpc} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to withdraw
      await usdt.transfer(user.address, 100 * 1e6);
      await usdt.connect(user).approve(vault.address, 1000 * 1e6);

      const userBalanceBefore = await usdt.balanceOf(user.address);
      const vaultBalanceBefore = await usdt.balanceOf(vault.address);

      const tx = vault.connect(mpc).depositTokens(user.address, usdt.address, 1000 * 1e6);

      await expect(tx).to.be.revertedWith("ERC20: transfer amount exceeds balance");

      const userBalanceAfter = await usdt.balanceOf(user.address);
      const vaultBalanceAfter = await usdt.balanceOf(vault.address);

      expect(userBalanceBefore).to.be.equal(100 * 1e6);
      expect(vaultBalanceBefore).to.be.equal(0);

      expect(userBalanceAfter).to.be.equal(100 * 1e6);
      expect(vaultBalanceAfter).to.be.equal(0);
    });
  });

  describe("depositTokensWithPermit()", () => {
    it("should deposit tokens with permit", async () => {
      const {vault, user, mpc, usdt} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to withdraw
      await usdt.transfer(user.address, 100 * 1e6);

      const userBalanceBefore = await usdt.balanceOf(user.address);
      const vaultBalanceBefore = await usdt.balanceOf(vault.address);

      const now = await time.latest();
      const deadline = now + 30 * 60;
      const amount = (50 * 1e6).toString();
      const permit = await getPermit(user, usdt, amount, vault.address, deadline);

      const tx = await vault.connect(mpc).depositTokensWithPermit(user.address, usdt.address, amount, permit);
      const receipt = await tx.wait();

      const userBalanceAfter = await usdt.balanceOf(user.address);
      const vaultBalanceAfter = await usdt.balanceOf(vault.address);

      expect(userBalanceBefore).eq(100 * 1e6);
      expect(userBalanceAfter).eq(50 * 1e6);

      expect(vaultBalanceBefore).eq(0);
      expect(vaultBalanceAfter).eq(50 * 1e6);

      expect(receipt.status).eq(1);
      expect(receipt.events).length(3);

      expect(receipt.events[0].address).to.be.equal(usdt.address);
      expect(receipt.events[0].topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Approval(address,address,uint256)")),
        user.address,
        vault.address,
      ]);
      expect(parseInt(receipt.events[0].data, 16)).to.be.equal(50 * 1e6);

      expect(receipt.events[1].address).to.be.equal(usdt.address);
      expect(receipt.events[1].topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Approval(address,address,uint256)")),
        user.address,
        vault.address,
      ]);
      expect(parseInt(receipt.events[1].data, 16)).to.be.equal(0);

      expect(receipt.events[2].address).to.be.equal(usdt.address);
      expect(receipt.events[2].topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Transfer(address,address,uint256)")),
        user.address,
        vault.address,
      ]);
      expect(parseInt(receipt.events[2].data, 16)).to.be.equal(50 * 1e6);
    });

    it("should deposit tokens with permit by operator", async () => {
      const {vault, operator, user, mpc, usdt} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to withdraw
      await usdt.transfer(user.address, 100 * 1e6);

      // initialize with an operator
      await vault.connect(mpc).initOperators([operator.address]);

      const userBalanceBefore = await usdt.balanceOf(user.address);
      const vaultBalanceBefore = await usdt.balanceOf(vault.address);

      const now = await time.latest();
      const deadline = now + 30 * 60;
      const amount = (50 * 1e6).toString();
      const permit = await getPermit(user, usdt, (1000 * 1e6).toString(), vault.address, deadline);

      const tx = await vault.connect(operator).depositTokensWithPermit(user.address, usdt.address, amount, permit);
      const receipt = await tx.wait();

      const userBalanceAfter = await usdt.balanceOf(user.address);
      const vaultBalanceAfter = await usdt.balanceOf(vault.address);

      expect(userBalanceBefore).eq(100 * 1e6);
      expect(userBalanceAfter).eq(50 * 1e6);

      expect(vaultBalanceBefore).eq(0);
      expect(vaultBalanceAfter).eq(50 * 1e6);

      expect(receipt.status).eq(1);
      expect(receipt.events).length(3);

      expect(receipt.events[0].address).to.be.equal(usdt.address);
      expect(receipt.events[0].topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Approval(address,address,uint256)")),
        user.address,
        vault.address,
      ]);
      expect(parseInt(receipt.events[0].data, 16)).to.be.equal(1000 * 1e6);

      expect(receipt.events[1].address).to.be.equal(usdt.address);
      expect(receipt.events[1].topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Approval(address,address,uint256)")),
        user.address,
        vault.address,
      ]);
      expect(parseInt(receipt.events[1].data, 16)).to.be.equal(950 * 1e6);

      expect(receipt.events[2].address).to.be.equal(usdt.address);
      expect(receipt.events[2].topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Transfer(address,address,uint256)")),
        user.address,
        vault.address,
      ]);
      expect(parseInt(receipt.events[2].data, 16)).to.be.equal(50 * 1e6);
    });

    it("should not deposit tokens with permit with recently added operator", async () => {
      const {vault, operator, user, mpc, usdt} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to withdraw
      await usdt.transfer(user.address, 100 * 1e6);

      // add operator w/ delay
      await vault.connect(mpc).addOperator(operator.address);

      const userBalanceBefore = await usdt.balanceOf(user.address);
      const vaultBalanceBefore = await usdt.balanceOf(vault.address);
      const operatorEffectiveTime = await vault.operators(operator.address);

      const now = await time.latest();
      const deadline = now + 30 * 60;
      const amount = (50 * 1e6).toString();
      const permit = await getPermit(user, usdt, (1000 * 1e6).toString(), vault.address, deadline);

      const tx = vault.connect(operator).depositTokensWithPermit(user.address, usdt.address, amount, permit);

      await expect(tx).to.be.revertedWith("MPCOperable: Must be MPC or operator");

      const userBalanceAfter = await usdt.balanceOf(user.address);
      const vaultBalanceAfter = await usdt.balanceOf(vault.address);

      expect(userBalanceBefore).eq(100 * 1e6);
      expect(userBalanceAfter).eq(100 * 1e6);

      expect(vaultBalanceBefore).eq(0);
      expect(vaultBalanceAfter).eq(0);

      expect(operatorEffectiveTime).not.eq(0);
    });

    it("should not deposit tokens with permit if has no access", async () => {
      const {vault, user, usdt} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to withdraw
      await usdt.transfer(user.address, 100 * 1e6);

      const userBalanceBefore = await usdt.balanceOf(user.address);
      const vaultBalanceBefore = await usdt.balanceOf(vault.address);

      const now = await time.latest();
      const deadline = now + 30 * 60;
      const amount = (50 * 1e6).toString();
      const permit = await getPermit(user, usdt, (1000 * 1e6).toString(), vault.address, deadline);

      const tx = vault.connect(user).depositTokensWithPermit(user.address, usdt.address, amount, permit);

      await expect(tx).to.be.revertedWith("MPCOperable: Must be MPC or operator");

      const userBalanceAfter = await usdt.balanceOf(user.address);
      const vaultBalanceAfter = await usdt.balanceOf(vault.address);

      expect(userBalanceBefore).eq(100 * 1e6);
      expect(userBalanceAfter).eq(100 * 1e6);

      expect(vaultBalanceBefore).eq(0);
      expect(vaultBalanceAfter).eq(0);
    });

    it("should not deposit tokens with permit if has not enough funds", async () => {
      const {vault, user, mpc, usdt} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to withdraw
      await usdt.transfer(user.address, 100 * 1e6);

      const userBalanceBefore = await usdt.balanceOf(user.address);
      const vaultBalanceBefore = await usdt.balanceOf(vault.address);

      const now = await time.latest();
      const deadline = now + 30 * 60;
      const amount = (1000 * 1e6).toString();
      const permit = await getPermit(user, usdt, amount, vault.address, deadline);

      const tx = vault.connect(mpc).depositTokensWithPermit(user.address, usdt.address, amount, permit);

      await expect(tx).to.be.revertedWith("ERC20: transfer amount exceeds balance");

      const userBalanceAfter = await usdt.balanceOf(user.address);
      const vaultBalanceAfter = await usdt.balanceOf(vault.address);

      expect(userBalanceBefore).eq(100 * 1e6);
      expect(userBalanceAfter).eq(100 * 1e6);

      expect(vaultBalanceBefore).eq(0);
      expect(vaultBalanceAfter).eq(0);
    });

    it("should not deposit tokens with permit if has not enough allowance", async () => {
      const {vault, user, mpc, usdt} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to withdraw
      await usdt.transfer(user.address, 100 * 1e6);

      const userBalanceBefore = await usdt.balanceOf(user.address);
      const vaultBalanceBefore = await usdt.balanceOf(vault.address);

      const now = await time.latest();
      const deadline = now + 30 * 60;
      const amount = (1000 * 1e6).toString();
      const permit = await getPermit(user, usdt, (10 * 1e6).toString(), vault.address, deadline);

      const tx = vault.connect(mpc).depositTokensWithPermit(user.address, usdt.address, amount, permit);

      await expect(tx).to.be.revertedWith("ERC20: insufficient allowance");

      const userBalanceAfter = await usdt.balanceOf(user.address);
      const vaultBalanceAfter = await usdt.balanceOf(vault.address);

      expect(userBalanceBefore).eq(100 * 1e6);
      expect(userBalanceAfter).eq(100 * 1e6);

      expect(vaultBalanceBefore).eq(0);
      expect(vaultBalanceAfter).eq(0);
    });

    it("should not deposit tokens with permit if expired", async () => {
      const {vault, user, mpc, usdt} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to withdraw
      await usdt.transfer(user.address, 100 * 1e6);

      const userBalanceBefore = await usdt.balanceOf(user.address);
      const vaultBalanceBefore = await usdt.balanceOf(vault.address);

      const now = await time.latest();
      const deadline = now - 30 * 60;
      const amount = (1000 * 1e6).toString();
      const permit = await getPermit(user, usdt, amount, vault.address, deadline);

      const tx = vault.connect(mpc).depositTokensWithPermit(user.address, usdt.address, amount, permit);

      await expect(tx).to.be.revertedWith("ERC20Permit: expired deadline");

      const userBalanceAfter = await usdt.balanceOf(user.address);
      const vaultBalanceAfter = await usdt.balanceOf(vault.address);

      expect(userBalanceBefore).eq(100 * 1e6);
      expect(userBalanceAfter).eq(100 * 1e6);

      expect(vaultBalanceBefore).eq(0);
      expect(vaultBalanceAfter).eq(0);
    });

    it("should not deposit tokens with permit if spender not matched", async () => {
      const {vault, user, mpc, usdt} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to withdraw
      await usdt.transfer(user.address, 100 * 1e6);

      const userBalanceBefore = await usdt.balanceOf(user.address);
      const vaultBalanceBefore = await usdt.balanceOf(vault.address);

      const now = await time.latest();
      const deadline = now + 30 * 60;
      const amount = (1000 * 1e6).toString();
      const permit = await getPermit(user, usdt, amount, user.address, deadline);

      const tx = vault.connect(mpc).depositTokensWithPermit(user.address, usdt.address, amount, permit);

      await expect(tx).to.be.revertedWith("ERC20Permit: invalid signature");

      const userBalanceAfter = await usdt.balanceOf(user.address);
      const vaultBalanceAfter = await usdt.balanceOf(vault.address);

      expect(userBalanceBefore).eq(100 * 1e6);
      expect(userBalanceAfter).eq(100 * 1e6);

      expect(vaultBalanceBefore).eq(0);
      expect(vaultBalanceAfter).eq(0);
    });
  });

  describe("depositTokensToMPC()", () => {
    it("should deposit tokens to mpc", async () => {
      const {vault, user, mpc, usdt} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to withdraw
      await usdt.transfer(user.address, 100 * 1e6);
      await usdt.connect(user).approve(vault.address, 100 * 1e6);

      const userBalanceBefore = await usdt.balanceOf(user.address);
      const vaultBalanceBefore = await usdt.balanceOf(vault.address);
      const mpcBalanceBefore = await usdt.balanceOf(mpc.address);

      const tx = await vault.connect(mpc).depositTokensToMPC(user.address, usdt.address, 70 * 1e6);
      const receipt = await tx.wait();

      const userBalanceAfter = await usdt.balanceOf(user.address);
      const vaultBalanceAfter = await usdt.balanceOf(vault.address);
      const mpcBalanceAfter = await usdt.balanceOf(mpc.address);

      expect(vaultBalanceBefore).eq(vaultBalanceAfter);

      expect(userBalanceBefore).to.be.equal(100 * 1e6);
      expect(userBalanceAfter).to.be.equal(30 * 1e6);

      expect(mpcBalanceBefore).to.be.equal(0);
      expect(mpcBalanceAfter).to.be.equal(70 * 1e6);

      expect(receipt.status).eq(1);
      expect(receipt.events).length(2);

      expect(receipt.events[0].address).to.be.equal(usdt.address);
      expect(receipt.events[0].topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Approval(address,address,uint256)")),
        user.address,
        vault.address,
      ]);
      expect(parseInt(receipt.events[0].data, 16)).to.be.equal(30 * 1e6);

      expect(receipt.events[1].address).to.be.equal(usdt.address);
      expect(receipt.events[1].topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Transfer(address,address,uint256)")),
        user.address,
        mpc.address,
      ]);
      expect(parseInt(receipt.events[1].data, 16)).to.be.equal(70 * 1e6);
    });

    it("should deposit tokens to mpc w/ unwrap weth", async () => {
      const {vault, user, mpc, weth} = await loadFixture(deploy);

      await weth.connect(user).deposit({value: parseEther("1.1")});
      await weth.connect(user).approve(vault.address, parseEther("1.1"));

      const userBalanceBefore = await weth.balanceOf(user.address);
      const vaultBalanceBefore = await weth.balanceOf(vault.address);
      const vaultValueBefore = await ethers.provider.getBalance(vault.address);
      const mpcBalanceBefore = await weth.balanceOf(mpc.address);
      const mpcValueBefore = await ethers.provider.getBalance(mpc.address);

      const tx = await vault.connect(mpc).depositTokensToMPC(user.address, weth.address, parseEther("1"));
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);

      const userBalanceAfter = await weth.balanceOf(user.address);
      const vaultBalanceAfter = await weth.balanceOf(vault.address);
      const vaultValueAfter = await ethers.provider.getBalance(vault.address);
      const mpcBalanceAfter = await weth.balanceOf(mpc.address);
      const mpcValueAfter = await ethers.provider.getBalance(mpc.address);

      expect(userBalanceBefore).eq(parseEther("1.1"));
      expect(userBalanceAfter).eq(parseEther("0.1"));

      expect(vaultBalanceBefore).eq(0);
      expect(vaultBalanceAfter).eq(0);

      expect(vaultValueBefore).eq(0);
      expect(vaultValueAfter).eq(0);

      expect(mpcBalanceBefore).eq(0);
      expect(mpcBalanceAfter).eq(0);

      expect(mpcValueAfter.add(gasUsed).sub(mpcValueBefore)).eq(parseEther("1"));

      expect(receipt.status).eq(1);
      expect(receipt.events).length(2);

      expect(receipt.events[0].address).to.be.equal(weth.address);
      expect(receipt.events[0].topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Transfer(address,address,uint256)")),
        user.address,
        vault.address,
      ]);
      expect(parseInt(receipt.events[0].data, 16)).to.be.equal(1e18);

      expect(receipt.events[1].address).to.be.equal(weth.address);
      expect(receipt.events[1].topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Withdrawal(address,uint256)")),
        vault.address,
      ]);
      expect(parseInt(receipt.events[1].data, 16)).to.be.equal(1e18);
    });

    it("should not deposit tokens to mpc if has no access", async () => {
      const {vault, user, usdt} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to withdraw
      await usdt.transfer(user.address, 100 * 1e6);

      const userBalanceBefore = await usdt.balanceOf(user.address);
      const vaultBalanceBefore = await usdt.balanceOf(vault.address);

      const tx = vault.connect(user).depositTokensToMPC(user.address, usdt.address, 50 * 1e6);

      await expect(tx).to.be.revertedWith("MPCOperable: Must be MPC or operator");

      const userBalanceAfter = await usdt.balanceOf(user.address);
      const vaultBalanceAfter = await usdt.balanceOf(vault.address);

      expect(userBalanceBefore).to.be.equal(100 * 1e6);
      expect(vaultBalanceBefore).to.be.equal(0);

      expect(userBalanceAfter).to.be.equal(100 * 1e6);
      expect(vaultBalanceAfter).to.be.equal(0);
    });

    it("should not deposit tokens to mpc if has not enough allowance", async () => {
      const {vault, user, usdt, mpc} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to withdraw
      await usdt.transfer(user.address, 1000 * 1e6);
      await usdt.connect(user).approve(vault.address, 100 * 1e6);

      const userBalanceBefore = await usdt.balanceOf(user.address);
      const mpcBalanceBefore = await usdt.balanceOf(mpc.address);

      const tx = vault.connect(mpc).depositTokensToMPC(user.address, usdt.address, 1000 * 1e6);

      await expect(tx).to.be.revertedWith("ERC20: insufficient allowance");

      const userBalanceAfter = await usdt.balanceOf(user.address);
      const mpcBalanceAfter = await usdt.balanceOf(mpc.address);

      expect(userBalanceBefore).to.be.equal(1000 * 1e6);
      expect(mpcBalanceBefore).to.be.equal(0);

      expect(userBalanceAfter).to.be.equal(1000 * 1e6);
      expect(mpcBalanceAfter).to.be.equal(0);
    });

    it("should not deposit tokens to mpc if has not enough funds", async () => {
      const {vault, user, usdt, mpc} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to withdraw
      await usdt.transfer(user.address, 100 * 1e6);
      await usdt.connect(user).approve(vault.address, 1000 * 1e6);

      const userBalanceBefore = await usdt.balanceOf(user.address);
      const mpcBalanceBefore = await usdt.balanceOf(mpc.address);

      const tx = vault.connect(mpc).depositTokensToMPC(user.address, usdt.address, 1000 * 1e6);

      await expect(tx).to.be.revertedWith("ERC20: transfer amount exceeds balance");

      const userBalanceAfter = await usdt.balanceOf(user.address);
      const mpcBalanceAfter = await usdt.balanceOf(mpc.address);

      expect(userBalanceBefore).to.be.equal(100 * 1e6);
      expect(mpcBalanceBefore).to.be.equal(0);

      expect(userBalanceAfter).to.be.equal(100 * 1e6);
      expect(mpcBalanceAfter).to.be.equal(0);
    });
  });

  describe("depositTokensToMPCWithPermit()", () => {
    it("should deposit tokens to mpc with permit", async () => {
      const {vault, user, mpc, usdt} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to withdraw
      await usdt.transfer(user.address, 100 * 1e6);

      const userBalanceBefore = await usdt.balanceOf(user.address);
      const mpcBalanceBefore = await usdt.balanceOf(mpc.address);

      const now = await time.latest();
      const deadline = now + 30 * 60;
      const amount = (50 * 1e6).toString();
      const permit = await getPermit(user, usdt, amount, vault.address, deadline);

      const tx = await vault.connect(mpc).depositTokensToMPCWithPermit(user.address, usdt.address, amount, permit);
      const receipt = await tx.wait();

      const userBalanceAfter = await usdt.balanceOf(user.address);
      const mpcBalanceAfter = await usdt.balanceOf(mpc.address);

      expect(userBalanceBefore).eq(100 * 1e6);
      expect(userBalanceAfter).eq(50 * 1e6);

      expect(mpcBalanceBefore).eq(0);
      expect(mpcBalanceAfter).eq(50 * 1e6);

      expect(receipt.status).eq(1);
      expect(receipt.events).length(3);

      expect(receipt.events[0].address).to.be.equal(usdt.address);
      expect(receipt.events[0].topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Approval(address,address,uint256)")),
        user.address,
        vault.address,
      ]);
      expect(parseInt(receipt.events[0].data, 16)).to.be.equal(50 * 1e6);

      expect(receipt.events[1].address).to.be.equal(usdt.address);
      expect(receipt.events[1].topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Approval(address,address,uint256)")),
        user.address,
        vault.address,
      ]);
      expect(parseInt(receipt.events[1].data, 16)).to.be.equal(0);

      expect(receipt.events[2].address).to.be.equal(usdt.address);
      expect(receipt.events[2].topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Transfer(address,address,uint256)")),
        user.address,
        mpc.address,
      ]);
      expect(parseInt(receipt.events[2].data, 16)).to.be.equal(50 * 1e6);
    });

    it("should deposit tokens to mpc with permit by operator", async () => {
      const {vault, operator, user, mpc, usdt} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to withdraw
      await usdt.transfer(user.address, 100 * 1e6);

      // initialize with an operator
      await vault.connect(mpc).initOperators([operator.address]);

      const userBalanceBefore = await usdt.balanceOf(user.address);
      const mpcBalanceBefore = await usdt.balanceOf(mpc.address);

      const now = await time.latest();
      const deadline = now + 30 * 60;
      const amount = (50 * 1e6).toString();
      const permit = await getPermit(user, usdt, (1000 * 1e6).toString(), vault.address, deadline);

      const tx = await vault.connect(operator).depositTokensToMPCWithPermit(user.address, usdt.address, amount, permit);
      const receipt = await tx.wait();

      const userBalanceAfter = await usdt.balanceOf(user.address);
      const mpcBalanceAfter = await usdt.balanceOf(mpc.address);

      expect(userBalanceBefore).eq(100 * 1e6);
      expect(userBalanceAfter).eq(50 * 1e6);

      expect(mpcBalanceBefore).eq(0);
      expect(mpcBalanceAfter).eq(50 * 1e6);

      expect(receipt.status).eq(1);
      expect(receipt.events).length(3);

      expect(receipt.events[0].address).to.be.equal(usdt.address);
      expect(receipt.events[0].topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Approval(address,address,uint256)")),
        user.address,
        vault.address,
      ]);
      expect(parseInt(receipt.events[0].data, 16)).to.be.equal(1000 * 1e6);

      expect(receipt.events[1].address).to.be.equal(usdt.address);
      expect(receipt.events[1].topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Approval(address,address,uint256)")),
        user.address,
        vault.address,
      ]);
      expect(parseInt(receipt.events[1].data, 16)).to.be.equal(950 * 1e6);

      expect(receipt.events[2].address).to.be.equal(usdt.address);
      expect(receipt.events[2].topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Transfer(address,address,uint256)")),
        user.address,
        mpc.address,
      ]);
      expect(parseInt(receipt.events[2].data, 16)).to.be.equal(50 * 1e6);
    });

    it("should not deposit tokens to mpc with permit with recently added operator", async () => {
      const {vault, operator, user, mpc, usdt} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to withdraw
      await usdt.transfer(user.address, 100 * 1e6);

      // add operator w/ delay
      await vault.connect(mpc).addOperator(operator.address);

      const userBalanceBefore = await usdt.balanceOf(user.address);
      const mpcBalanceBefore = await usdt.balanceOf(mpc.address);
      const operatorEffectiveTime = await vault.operators(operator.address);

      const now = await time.latest();
      const deadline = now + 30 * 60;
      const amount = (50 * 1e6).toString();
      const permit = await getPermit(user, usdt, (1000 * 1e6).toString(), vault.address, deadline);

      const tx = vault.connect(operator).depositTokensToMPCWithPermit(user.address, usdt.address, amount, permit);

      await expect(tx).to.be.revertedWith("MPCOperable: Must be MPC or operator");

      const userBalanceAfter = await usdt.balanceOf(user.address);
      const mpcBalanceAfter = await usdt.balanceOf(mpc.address);

      expect(userBalanceBefore).eq(100 * 1e6);
      expect(userBalanceAfter).eq(100 * 1e6);

      expect(mpcBalanceBefore).eq(0);
      expect(mpcBalanceAfter).eq(0);

      expect(operatorEffectiveTime).not.eq(0);
    });

    it("should not deposit tokens to mpc with permit if has no access", async () => {
      const {vault, user, mpc, usdt} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to withdraw
      await usdt.transfer(user.address, 100 * 1e6);

      const userBalanceBefore = await usdt.balanceOf(user.address);
      const mpcBalanceBefore = await usdt.balanceOf(mpc.address);

      const now = await time.latest();
      const deadline = now + 30 * 60;
      const amount = (50 * 1e6).toString();
      const permit = await getPermit(user, usdt, (1000 * 1e6).toString(), vault.address, deadline);

      const tx = vault.connect(user).depositTokensToMPCWithPermit(user.address, usdt.address, amount, permit);

      await expect(tx).to.be.revertedWith("MPCOperable: Must be MPC or operator");

      const userBalanceAfter = await usdt.balanceOf(user.address);
      const mpcBalanceAfter = await usdt.balanceOf(mpc.address);

      expect(userBalanceBefore).eq(100 * 1e6);
      expect(userBalanceAfter).eq(100 * 1e6);

      expect(mpcBalanceBefore).eq(0);
      expect(mpcBalanceAfter).eq(0);
    });

    it("should not deposit tokens to mpc with permit if has not enough funds", async () => {
      const {vault, user, mpc, usdt} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to withdraw
      await usdt.transfer(user.address, 100 * 1e6);

      const userBalanceBefore = await usdt.balanceOf(user.address);
      const mpcBalanceBefore = await usdt.balanceOf(mpc.address);

      const now = await time.latest();
      const deadline = now + 30 * 60;
      const amount = (1000 * 1e6).toString();
      const permit = await getPermit(user, usdt, (1000 * 1e6).toString(), vault.address, deadline);

      const tx = vault.connect(mpc).depositTokensToMPCWithPermit(user.address, usdt.address, amount, permit);

      await expect(tx).to.be.revertedWith("ERC20: transfer amount exceeds balance");

      const userBalanceAfter = await usdt.balanceOf(user.address);
      const mpcBalanceAfter = await usdt.balanceOf(mpc.address);

      expect(userBalanceBefore).eq(100 * 1e6);
      expect(userBalanceAfter).eq(100 * 1e6);

      expect(mpcBalanceBefore).eq(0);
      expect(mpcBalanceAfter).eq(0);
    });

    it("should not deposit tokens to mpc with permit if has not enough allowance", async () => {
      const {vault, user, mpc, usdt} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to withdraw
      await usdt.transfer(user.address, 100 * 1e6);

      const userBalanceBefore = await usdt.balanceOf(user.address);
      const mpcBalanceBefore = await usdt.balanceOf(mpc.address);

      const now = await time.latest();
      const deadline = now + 30 * 60;
      const amount = (1000 * 1e6).toString();
      const permit = await getPermit(user, usdt, (10 * 1e6).toString(), vault.address, deadline);

      const tx = vault.connect(mpc).depositTokensToMPCWithPermit(user.address, usdt.address, amount, permit);

      await expect(tx).to.be.revertedWith("ERC20: insufficient allowance");

      const userBalanceAfter = await usdt.balanceOf(user.address);
      const mpcBalanceAfter = await usdt.balanceOf(mpc.address);

      expect(userBalanceBefore).eq(100 * 1e6);
      expect(userBalanceAfter).eq(100 * 1e6);

      expect(mpcBalanceBefore).eq(0);
      expect(mpcBalanceAfter).eq(0);
    });

    it("should not deposit tokens to mpc with permit if expired", async () => {
      const {vault, user, mpc, usdt} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to withdraw
      await usdt.transfer(user.address, 100 * 1e6);

      const userBalanceBefore = await usdt.balanceOf(user.address);
      const mpcBalanceBefore = await usdt.balanceOf(mpc.address);

      const now = await time.latest();
      const deadline = now - 30 * 60;
      const amount = (100 * 1e6).toString();
      const permit = await getPermit(user, usdt, amount.toString(), vault.address, deadline);

      const tx = vault.connect(mpc).depositTokensToMPCWithPermit(user.address, usdt.address, amount, permit);

      await expect(tx).to.be.revertedWith("ERC20Permit: expired deadline");

      const userBalanceAfter = await usdt.balanceOf(user.address);
      const mpcBalanceAfter = await usdt.balanceOf(mpc.address);

      expect(userBalanceBefore).eq(100 * 1e6);
      expect(userBalanceAfter).eq(100 * 1e6);

      expect(mpcBalanceBefore).eq(0);
      expect(mpcBalanceAfter).eq(0);
    });

    it("should not deposit tokens to mpc with permit if spender not matched", async () => {
      const {vault, user, mpc, usdt} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to withdraw
      await usdt.transfer(user.address, 100 * 1e6);

      const userBalanceBefore = await usdt.balanceOf(user.address);
      const mpcBalanceBefore = await usdt.balanceOf(mpc.address);

      const now = await time.latest();
      const deadline = now + 30 * 60;
      const amount = (100 * 1e6).toString();
      const permit = await getPermit(user, usdt, amount.toString(), user.address, deadline);

      const tx = vault.connect(mpc).depositTokensToMPCWithPermit(user.address, usdt.address, amount, permit);

      await expect(tx).to.be.revertedWith("ERC20Permit: invalid signature");

      const userBalanceAfter = await usdt.balanceOf(user.address);
      const mpcBalanceAfter = await usdt.balanceOf(mpc.address);

      expect(userBalanceBefore).eq(100 * 1e6);
      expect(userBalanceAfter).eq(100 * 1e6);

      expect(mpcBalanceBefore).eq(0);
      expect(mpcBalanceAfter).eq(0);
    });
  });

  describe("withdrawTokens()", () => {
    it("should withdraw tokens", async () => {
      const {vault, user, mpc, usdt} = await loadFixture(deploy);

      // top up vault to be sure here's enough funds to withdraw
      await usdt.transfer(vault.address, 100 * 1e6);

      const userBalanceBefore = await usdt.balanceOf(user.address);
      const vaultBalanceBefore = await usdt.balanceOf(vault.address);

      const tx = await vault.connect(mpc).withdrawTokens(user.address, usdt.address, 50 * 1e6);
      const receipt = await tx.wait();

      const userBalanceAfter = await usdt.balanceOf(user.address);
      const vaultBalanceAfter = await usdt.balanceOf(vault.address);

      expect(vaultBalanceBefore).to.be.equal(100 * 1e6);
      expect(vaultBalanceAfter).to.be.equal(50 * 1e6);

      expect(userBalanceBefore).to.be.equal(0);
      expect(userBalanceAfter).to.be.equal(50 * 1e6);

      expect(receipt.events[0].address).to.be.equal(usdt.address);
      expect(receipt.events[0].topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Transfer(address,address,uint256)")),
        vault.address,
        user.address,
      ]);
      expect(parseInt(receipt.events[0].data, 16)).to.be.equal(50 * 1e6);
    });

    it("should withdraw tokens by operator", async () => {
      const {vault, operator, user, mpc, usdt} = await loadFixture(deploy);

      // top up vault to be sure here's enough funds to withdraw
      await usdt.transfer(vault.address, 100 * 1e6);

      // initialize with an operator
      await vault.connect(mpc).initOperators([operator.address]);

      const userBalanceBefore = await usdt.balanceOf(user.address);
      const vaultBalanceBefore = await usdt.balanceOf(vault.address);

      const tx = await vault.connect(operator).withdrawTokens(user.address, usdt.address, 50 * 1e6);
      const receipt = await tx.wait();

      const userBalanceAfter = await usdt.balanceOf(user.address);
      const vaultBalanceAfter = await usdt.balanceOf(vault.address);

      expect(vaultBalanceBefore).to.be.equal(100 * 1e6);
      expect(vaultBalanceAfter).to.be.equal(50 * 1e6);

      expect(userBalanceBefore).to.be.equal(0);
      expect(userBalanceAfter).to.be.equal(50 * 1e6);

      expect(receipt.events[0].address).to.be.equal(usdt.address);
      expect(receipt.events[0].topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Transfer(address,address,uint256)")),
        vault.address,
        user.address,
      ]);
      expect(parseInt(receipt.events[0].data, 16)).to.be.equal(50 * 1e6);
    });

    it("should not withdraw by recently added operator", async () => {
      const {vault, operator, user, mpc, usdt} = await loadFixture(deploy);

      // top up vault to be sure here's enough funds to withdraw
      await usdt.transfer(vault.address, 100 * 1e6);

      // add operator w/ delay
      await vault.connect(mpc).addOperator(operator.address);

      const userBalanceBefore = await usdt.balanceOf(user.address);
      const vaultBalanceBefore = await usdt.balanceOf(vault.address);
      const operatorEffectiveTime = await vault.operators(operator.address);
      const tx = vault.connect(operator).withdrawTokens(user.address, usdt.address, 50 * 1e6);

      await expect(tx).to.be.revertedWith("MPCOperable: Must be MPC or operator");

      const userBalanceAfter = await usdt.balanceOf(user.address);
      const vaultBalanceAfter = await usdt.balanceOf(vault.address);

      expect(vaultBalanceBefore).to.be.equal(100 * 1e6);
      expect(vaultBalanceAfter).to.be.equal(100 * 1e6);

      expect(userBalanceBefore).to.be.equal(0);
      expect(userBalanceAfter).to.be.equal(0);

      expect(operatorEffectiveTime).not.eq(0);
    });

    it("should not withdraw if has no access", async () => {
      const {vault, user, usdt} = await loadFixture(deploy);

      // top up vault to be sure here's enough funds to withdraw
      await usdt.transfer(vault.address, 100 * 1e6);

      const userBalanceBefore = await usdt.balanceOf(user.address);
      const vaultBalanceBefore = await usdt.balanceOf(vault.address);
      const tx = vault.connect(user).withdrawTokens(user.address, usdt.address, 50 * 1e6);

      await expect(tx).to.be.revertedWith("MPCOperable: Must be MPC or operator");

      const userBalanceAfter = await usdt.balanceOf(user.address);
      const vaultBalanceAfter = await usdt.balanceOf(vault.address);

      expect(vaultBalanceBefore).to.be.equal(100 * 1e6);
      expect(vaultBalanceAfter).to.be.equal(100 * 1e6);

      expect(userBalanceBefore).to.be.equal(0);
      expect(userBalanceAfter).to.be.equal(0);
    });

    it("should not withdraw if has no funds", async () => {
      const {vault, user, mpc, usdt} = await loadFixture(deploy);

      // top up vault to be sure here's enough funds to withdraw
      await usdt.transfer(vault.address, 100 * 1e6);

      const userBalanceBefore = await usdt.balanceOf(user.address);
      const vaultBalanceBefore = await usdt.balanceOf(vault.address);
      const tx = vault.connect(mpc).withdrawTokens(user.address, usdt.address, 1000 * 1e6);

      await expect(tx).to.be.revertedWith("ERC20: transfer amount exceeds balance");

      const userBalanceAfter = await usdt.balanceOf(user.address);
      const vaultBalanceAfter = await usdt.balanceOf(vault.address);

      expect(vaultBalanceBefore).to.be.equal(100 * 1e6);
      expect(vaultBalanceAfter).to.be.equal(100 * 1e6);

      expect(userBalanceBefore).to.be.equal(0);
      expect(userBalanceAfter).to.be.equal(0);
    });
  });

  describe("withdraw()", () => {
    it("should withdraw", async () => {
      const {vault, user, mpc} = await loadFixture(deploy);

      // top up vault to be sure here's enough funds to withdraw
      await vault.deposit({value: parseEther("1")});

      const userValueBefore = await ethers.provider.getBalance(user.address);
      const vaultValueBefore = await ethers.provider.getBalance(vault.address);

      await vault.connect(mpc).withdraw(user.address, parseEther("0.5"));

      const userValueAfter = await ethers.provider.getBalance(user.address);
      const vaultValueAfter = await ethers.provider.getBalance(vault.address);

      expect(userValueAfter.sub(userValueBefore)).eq(parseEther("0.5"));
      expect(vaultValueAfter.sub(vaultValueBefore)).eq(parseEther("-0.5"));
    });

    it("should withdraw by operator", async () => {
      const {vault, operator, user, mpc} = await loadFixture(deploy);

      // top up vault to be sure here's enough funds to withdraw
      await vault.deposit({value: parseEther("1")});

      // initialize with an operator
      await vault.connect(mpc).initOperators([operator.address]);

      const userValueBefore = await ethers.provider.getBalance(user.address);
      const vaultValueBefore = await ethers.provider.getBalance(vault.address);

      await vault.connect(operator).withdraw(user.address, parseEther("0.5"));

      const userValueAfter = await ethers.provider.getBalance(user.address);
      const vaultValueAfter = await ethers.provider.getBalance(vault.address);

      expect(userValueAfter.sub(userValueBefore)).eq(parseEther("0.5"));
      expect(vaultValueAfter.sub(vaultValueBefore)).eq(parseEther("-0.5"));
    });

    it("should withdraw to the payable contract", async () => {
      const {vault, payableContract, user, mpc} = await loadFixture(deploy);

      // top up vault to be sure here's enough funds to withdraw
      await vault.deposit({value: parseEther("1")});

      const userValueBefore = await ethers.provider.getBalance(user.address);
      const vaultValueBefore = await ethers.provider.getBalance(vault.address);
      const vaultIncomeBefore = await payableContract.incomes(vault.address);

      await vault.connect(mpc).withdraw(payableContract.address, parseEther("0.5"));

      const userValueAfter = await ethers.provider.getBalance(user.address);
      const vaultValueAfter = await ethers.provider.getBalance(vault.address);
      const vaultIncomeAfter = await payableContract.incomes(vault.address);

      expect(userValueAfter.sub(userValueBefore)).eq(parseEther("0.5"));
      expect(vaultValueAfter.sub(vaultValueBefore)).eq(parseEther("-0.5"));

      expect(vaultIncomeBefore).eq(0);
      expect(vaultIncomeAfter).eq(parseEther("0.5"));
    });

    it("should not withdraw by recently added operator", async () => {
      const {vault, operator, mpc} = await loadFixture(deploy);

      // top up vault to be sure here's enough funds to withdraw
      await vault.deposit({value: parseEther("1")});

      // add operator w/ delay
      await vault.connect(mpc).addOperator(operator.address);

      const vaultValueBefore = await ethers.provider.getBalance(vault.address);
      const operatorEffectiveTime = await vault.operators(operator.address);
      const tx = vault.connect(operator).withdraw(operator.address, parseEther("0.5"));

      await expect(tx).to.be.revertedWith("MPCOperable: Must be MPC or operator");

      const vaultValueAfter = await ethers.provider.getBalance(vault.address);

      expect(vaultValueBefore).eq(parseEther("1"));
      expect(vaultValueAfter).eq(parseEther("1"));

      expect(operatorEffectiveTime).not.eq(0);
    });

    it("should not withdraw if has no access", async () => {
      const {vault, user} = await loadFixture(deploy);

      // top up vault to be sure here's enough funds to withdraw
      await vault.deposit({value: parseEther("1")});

      const vaultValueBefore = await ethers.provider.getBalance(vault.address);
      const tx = vault.connect(user).withdraw(user.address, parseEther("0.5"));

      await expect(tx).to.be.revertedWith("MPCOperable: Must be MPC or operator");

      const vaultValueAfter = await ethers.provider.getBalance(vault.address);

      expect(vaultValueBefore).eq(parseEther("1"));
      expect(vaultValueAfter).eq(parseEther("1"));
    });

    it("should not withdraw if has no funds", async () => {
      const {vault, user, mpc} = await loadFixture(deploy);

      // top up vault to be sure here's enough funds to withdraw
      await vault.deposit({value: parseEther("1")});

      const userValueBefore = await ethers.provider.getBalance(user.address);
      const vaultValueBefore = await ethers.provider.getBalance(vault.address);

      const tx = vault.connect(mpc).withdraw(user.address, parseEther("10"));

      await expect(tx).to.be.revertedWith("Vault: Sending ETH has been failed");

      const userValueAfter = await ethers.provider.getBalance(user.address);
      const vaultValueAfter = await ethers.provider.getBalance(vault.address);

      expect(userValueBefore).to.be.equal(userValueAfter);
      expect(vaultValueBefore).to.be.equal(vaultValueAfter);
    });
  });

  describe("receive()", () => {
    it("should receive tokens", async () => {
      const {vault, user, usdt} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to transfer
      await usdt.transfer(user.address, 100 * 1e6);

      const userBalanceBefore = await usdt.balanceOf(user.address);
      const vaultBalanceBefore = await usdt.balanceOf(vault.address);

      await user.sendTransaction({
        to: usdt.address,
        data: usdt.interface.encodeFunctionData("transfer", [vault.address, 60 * 1e6]),
        gasLimit: 1e5,
      });

      const userBalanceAfter = await usdt.balanceOf(user.address);
      const vaultBalanceAfter = await usdt.balanceOf(vault.address);

      expect(userBalanceBefore).to.be.equal(100 * 1e6);
      expect(vaultBalanceBefore).to.be.equal(0);

      expect(userBalanceAfter).to.be.equal(40 * 1e6);
      expect(vaultBalanceAfter).to.be.equal(60 * 1e6);
    });

    it("should receive eth", async () => {
      const {vault, user} = await loadFixture(deploy);

      const userValueBefore = await ethers.provider.getBalance(user.address);
      const vaultValueBefore = await ethers.provider.getBalance(vault.address);

      const tx = await user.sendTransaction({
        to: vault.address,
        value: parseEther("1"),
        gasLimit: 1e5,
      });

      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);

      const userValueAfter = await ethers.provider.getBalance(user.address);
      const vaultValueAfter = await ethers.provider.getBalance(vault.address);

      expect(userValueAfter.add(gasUsed).sub(userValueBefore)).eq(parseEther("-1"));

      expect(vaultValueBefore).eq(0);
      expect(vaultValueAfter).eq(parseEther("1"));
    });
  });
});
