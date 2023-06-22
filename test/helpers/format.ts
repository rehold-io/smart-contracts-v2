import {ethers, utils} from "ethers";
import {BigNumber} from "bignumber.js";

const YIELD_DECIMALS = 8;
const AMOUNT_DECIMALS = 18;
const PRICE_DECIMALS = 18;

export const getId = (dual: any) => {
  const payload = ethers.utils.defaultAbiCoder.encode(
    ["address", "uint256", "bytes32", "address", "address", "address", "uint256", "uint256", "uint256", "uint256"],
    [
      dual.user,
      dual.chainId,
      dual.parentId,
      dual.baseToken,
      dual.quoteToken,
      dual.inputToken,
      dual.inputAmount,
      dual.yield,
      dual.initialPrice,
      dual.finishAt,
    ],
  );

  return ethers.utils.keccak256(payload);
};

export const getTariffHash = (tariff: any) => {
  const packed = ethers.utils.defaultAbiCoder.encode(
    [
      "uint256",
      "address",
      "address",
      "address",
      "uint256",
      "uint256",
      "uint256",
      "uint256",
      "uint256",
      "uint256",
      "uint256",
      "uint256",
      "uint256",
    ],
    [
      tariff.chainId,
      tariff.user,
      tariff.baseToken,
      tariff.quoteToken,
      tariff.minBaseAmount,
      tariff.maxBaseAmount,
      tariff.minQuoteAmount,
      tariff.maxQuoteAmount,
      tariff.thresholdBaseAmount,
      tariff.thresholdQuoteAmount,
      tariff.stakingPeriod,

      tariff.yield,
      tariff.expireAt,
    ],
  );

  return utils.arrayify(utils.keccak256(packed));
};

export const toUint256 = (value: number, decimals: number) => {
  return new BigNumber(value).times(10 ** decimals).toFixed(0);
};

export const toYieldUint256 = (value: any) => {
  return toUint256(value, YIELD_DECIMALS);
};

export const toAmountUint256 = (value: any) => {
  return toUint256(value, AMOUNT_DECIMALS);
};

export const toPriceUint256 = (value: any) => {
  return toUint256(value, PRICE_DECIMALS);
};
