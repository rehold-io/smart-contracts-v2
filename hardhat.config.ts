/* eslint-disable import/no-extraneous-dependencies */
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import {HardhatUserConfig} from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomiclabs/hardhat-etherscan";

dotenv.config();

const {NODE_ENV} = process.env;

if (NODE_ENV && fs.existsSync(path.resolve(`.env.${NODE_ENV}`))) {
  const variables = dotenv.parse(fs.readFileSync(path.resolve(`.env.${NODE_ENV}`)));

  for (const key in variables) {
    process.env[key] = variables[key];
  }
}

const accounts = process.env.SECRETS.split(",");

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.17",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000,
          },
        },
      },
      {
        version: "0.4.18",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000,
          },
        },
      },
    ],
  },
  etherscan: {
    apiKey: {
      mainnet: process.env.ETHERSCAN_API_KEY as string,
      bsc: process.env.BSCSCAN_API_KEY as string,
      arbitrumOne: process.env.ARBISCAN_API_KEY as string,
      polygon: process.env.POLYGONSCAN_API_KEY as string,
      avalanche: process.env.SNOWTRACE_API_KEY as string,
      optimisticEthereum: process.env.OPTIMISTICSCAN_API_KEY as string,
    },
  },
  networks: {
    mainnet: {
      url: "https://rpc.ankr.com/eth",
      accounts,
    },
    bsc: {
      url: "https://rpc.ankr.com/bsc",
      accounts,
    },
    arbitrumOne: {
      url: "https://rpc.ankr.com/arbitrum",
      accounts,
    },
    polygon: {
      url: "https://rpc.ankr.com/polygon",
      accounts,
    },
    avalanche: {
      url: "https://rpc.ankr.com/avalanche",
      accounts,
    },
    optimisticEthereum: {
      url: "https://rpc.ankr.com/optimism",
      accounts,
    },
  },
};

export default config;
