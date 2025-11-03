pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract SmartMeterBilling is ZamaEthereumConfig {
    struct MeterReading {
        euint32 encryptedConsumption;
        uint256 timestamp;
        uint256 rate;
        bool isDecrypted;
        uint32 decryptedConsumption;
    }

    mapping(address => MeterReading[]) public userReadings;
    mapping(address => uint256) public userBalances;

    event ReadingSubmitted(address indexed user, uint256 timestamp);
    event BillCalculated(address indexed user, uint256 amount);
    event ReadingDecrypted(address indexed user, uint256 timestamp, uint32 consumption);

    constructor() ZamaEthereumConfig() {}

    function submitReading(
        externalEuint32 encryptedConsumption,
        bytes calldata inputProof,
        uint256 rate
    ) external {
        require(FHE.isInitialized(FHE.fromExternal(encryptedConsumption, inputProof)), "Invalid encrypted input");

        euint32 encryptedValue = FHE.fromExternal(encryptedConsumption, inputProof);
        FHE.allowThis(encryptedValue);
        FHE.makePubliclyDecryptable(encryptedValue);

        userReadings[msg.sender].push(MeterReading({
            encryptedConsumption: encryptedValue,
            timestamp: block.timestamp,
            rate: rate,
            isDecrypted: false,
            decryptedConsumption: 0
        }));

        emit ReadingSubmitted(msg.sender, block.timestamp);
    }

    function calculateBill(address user, uint256 index) external {
        require(index < userReadings[user].length, "Invalid reading index");
        MeterReading storage reading = userReadings[user][index];
        require(!reading.isDecrypted, "Reading already decrypted");

        // Homomorphic computation of bill amount
        euint32 encryptedBill = FHE.mul(reading.encryptedConsumption, FHE.euint32(reading.rate));
        FHE.allowThis(encryptedBill);

        // Store encrypted bill in state (simplified)
        // In production, you'd typically store or process this differently
        userBalances[user] += reading.rate; // Placeholder for actual encrypted value handling

        emit BillCalculated(user, reading.rate); // Placeholder value
    }

    function decryptReading(
        address user,
        uint256 index,
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(index < userReadings[user].length, "Invalid reading index");
        MeterReading storage reading = userReadings[user][index];
        require(!reading.isDecrypted, "Reading already decrypted");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(reading.encryptedConsumption);

        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);

        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));
        reading.decryptedConsumption = decodedValue;
        reading.isDecrypted = true;

        emit ReadingDecrypted(user, reading.timestamp, decodedValue);
    }

    function getReading(address user, uint256 index) external view returns (
        euint32 encryptedConsumption,
        uint256 timestamp,
        uint256 rate,
        bool isDecrypted,
        uint32 decryptedConsumption
    ) {
        require(index < userReadings[user].length, "Invalid reading index");
        MeterReading storage reading = userReadings[user][index];

        return (
            reading.encryptedConsumption,
            reading.timestamp,
            reading.rate,
            reading.isDecrypted,
            reading.decryptedConsumption
        );
    }

    function getReadingCount(address user) external view returns (uint256) {
        return userReadings[user].length;
    }

    function getBalance(address user) external view returns (uint256) {
        return userBalances[user];
    }

    // Homomorphic computation helpers
    function _computeBill(euint32 consumption, uint256 rate) internal pure returns (euint32) {
        return FHE.mul(consumption, FHE.euint32(rate));
    }

    // FHE configuration
    function maxLevel() public pure override returns (uint256) {
        return 6;
    }

    function log2Scale() public pure override returns (uint256) {
        return 20;
    }

    function bitsPerLevel() public pure override returns (uint256) {
        return 8;
    }
}

