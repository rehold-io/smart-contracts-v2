import {network} from "hardhat";
import {ethers} from "ethers";
import {toAmountUint256, toPriceUint256, toYieldUint256} from "./format";

export const dualFactory = {
  tariff: (state: any) => ({
    chainId: network.config.chainId as number,
    baseToken: state.btcb.address,
    quoteToken: state.usdt.address,
    stakingPeriod: 24,
    yield: toYieldUint256(0.01),
  }),

  input: (state: any) => ({
    user: state.user.address,
    parentId: "0xa1fbbbcc7eae37d3050fd786a0b2e122540dd524dd173fbc66840a72e7e20d47",
    token: state.btcb.address,
    amount: toAmountUint256(1),
    initialPrice: toPriceUint256(30_000),
    startedAt: Math.round(Date.now() / 1000).toString(),
  }),

  dual: (tariff: any, input: any) => {
    const stakingPeriod = +tariff.stakingPeriod;
    const startedAt = +input.startedAt;
    const finishAt = startedAt + stakingPeriod * 60 * 60;

    return {
      user: input.user,
      chainId: tariff.chainId,
      parentId: input.parentId,
      baseToken: tariff.baseToken,
      quoteToken: tariff.quoteToken,
      inputToken: input.token,
      inputAmount: input.amount,
      outputToken: ethers.constants.AddressZero,
      outputAmount: toAmountUint256(0),
      yield: tariff.yield,
      initialPrice: input.initialPrice,
      closedPrice: toPriceUint256(0),
      finishAt: finishAt.toString(),
    };
  },

  dualClaimed: (tariff: any, input: any) => {
    const closedPrice = toPriceUint256(31_000);

    return {
      ...dualFactory.dual(tariff, input),
      closedPrice,
    };
  },
};

export const router = {
  tariff: (state: any) => ({
    chainId: network.config.chainId,
    user: ethers.constants.AddressZero,
    baseToken: state.btcb.address,
    quoteToken: state.usdt.address,
    minBaseAmount: toAmountUint256(0.1),
    maxBaseAmount: toAmountUint256(10),
    minQuoteAmount: 50 * 1e6,
    maxQuoteAmount: 10_000 * 1e6,
    thresholdBaseAmount: toAmountUint256(0.5),
    thresholdQuoteAmount: 3000 * 1e6,
    stakingPeriod: 12,
    yield: toYieldUint256(0.00205479),
    expireAt: Math.round(Date.now() / 1000 + 30 * 60).toString(),
  }),
};
