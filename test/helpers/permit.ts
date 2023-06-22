import {ethers, network} from "hardhat";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Token} from "../../typechain-types";

export async function getPermit(
  user: SignerWithAddress,
  inputToken: Token,
  inputAmount: string,
  spender: string,
  deadline: number,
) {
  // get the current nonce for the deployer address
  const nonces = await inputToken.nonces(user.address);

  // set the domain parameters
  const domain = {
    name: await inputToken.name(),
    version: "1",
    chainId: network.config.chainId,
    verifyingContract: inputToken.address,
  };

  // set the Permit type parameters
  const types = {
    Permit: [
      {
        name: "owner",
        type: "address",
      },
      {
        name: "spender",
        type: "address",
      },
      {
        name: "value",
        type: "uint256",
      },
      {
        name: "nonce",
        type: "uint256",
      },
      {
        name: "deadline",
        type: "uint256",
      },
    ],
  };

  // set the Permit type values
  const values = {
    owner: user.address,
    spender,
    value: inputAmount,
    nonce: nonces,
    deadline,
  };

  // sign the Permit type data with the deployer's private key
  const signature = await user._signTypedData(domain, types, values);

  // split the signature into its components
  const splittedSignature = ethers.utils.splitSignature(signature);

  return {
    amount: inputAmount,
    deadline,
    v: splittedSignature.v,
    r: splittedSignature.r,
    s: splittedSignature.s,
  };
}
