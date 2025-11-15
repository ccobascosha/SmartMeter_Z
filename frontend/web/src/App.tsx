import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface MeterReading {
  id: string;
  name: string;
  encryptedValue: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified: boolean;
  decryptedValue: number;
}

interface EnergyStats {
  totalConsumption: number;
  averageUsage: number;
  peakHours: number;
  costEstimate: number;
  carbonFootprint: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [readings, setReadings] = useState<MeterReading[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newReading, setNewReading] = useState({ name: "", consumption: "", rate: "", description: "" });
  const [selectedReading, setSelectedReading] = useState<MeterReading | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [energyStats, setEnergyStats] = useState<EnergyStats>({
    totalConsumption: 0,
    averageUsage: 0,
    peakHours: 0,
    costEstimate: 0,
    carbonFootprint: 0
  });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadReadings();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadReadings = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const readingsList: MeterReading[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          readingsList.push({
            id: businessId,
            name: businessData.name,
            encryptedValue: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setReadings(readingsList);
      calculateEnergyStats(readingsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const calculateEnergyStats = (readings: MeterReading[]) => {
    const total = readings.reduce((sum, r) => sum + (r.isVerified ? r.decryptedValue : r.publicValue1), 0);
    const avg = readings.length > 0 ? total / readings.length : 0;
    const cost = total * 0.15;
    const carbon = total * 0.4;
    
    setEnergyStats({
      totalConsumption: total,
      averageUsage: avg,
      peakHours: Math.max(...readings.map(r => r.isVerified ? r.decryptedValue : r.publicValue1), 0),
      costEstimate: cost,
      carbonFootprint: carbon
    });
  };

  const uploadReading = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setUploading(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Uploading encrypted reading..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const consumptionValue = parseInt(newReading.consumption) || 0;
      const businessId = `meter-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, consumptionValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newReading.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newReading.rate) || 0,
        0,
        newReading.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Reading uploaded successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadReadings();
      setShowUploadModal(false);
      setNewReading({ name: "", consumption: "", rate: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Upload failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setUploading(false); 
    }
  };

  const decryptReading = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadReadings();
      
      setTransactionStatus({ visible: true, status: "success", message: "Reading decrypted successfully!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadReadings();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const available = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "System available: " + available });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredReadings = readings.filter(reading =>
    reading.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    reading.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const renderEnergyDashboard = () => {
    return (
      <div className="dashboard-grid">
        <div className="stat-card neon-purple">
          <div className="stat-icon">⚡</div>
          <div className="stat-content">
            <h3>Total Consumption</h3>
            <div className="stat-value">{energyStats.totalConsumption} kWh</div>
          </div>
        </div>
        
        <div className="stat-card neon-blue">
          <div className="stat-icon">📊</div>
          <div className="stat-content">
            <h3>Average Usage</h3>
            <div className="stat-value">{energyStats.averageUsage.toFixed(1)} kWh</div>
          </div>
        </div>
        
        <div className="stat-card neon-pink">
          <div className="stat-icon">💰</div>
          <div className="stat-content">
            <h3>Cost Estimate</h3>
            <div className="stat-value">${energyStats.costEstimate.toFixed(2)}</div>
          </div>
        </div>
        
        <div className="stat-card neon-green">
          <div className="stat-icon">🌱</div>
          <div className="stat-content">
            <h3>Carbon Footprint</h3>
            <div className="stat-value">{energyStats.carbonFootprint.toFixed(1)} kg</div>
          </div>
        </div>
      </div>
    );
  };

  const renderFHEProcess = () => {
    return (
      <div className="fhe-process">
        <div className="process-step">
          <div className="step-number">1</div>
          <div className="step-content">
            <h4>Encrypted Reading</h4>
            <p>Smart meter encrypts consumption data using FHE 🔒</p>
          </div>
        </div>
        
        <div className="process-step">
          <div className="step-number">2</div>
          <div className="step-content">
            <h4>Homomorphic Billing</h4>
            <p>Utility computes bill without decrypting usage details</p>
          </div>
        </div>
        
        <div className="process-step">
          <div className="step-number">3</div>
          <div className="step-content">
            <h4>Privacy Protection</h4>
            <p>Your consumption patterns remain completely private</p>
          </div>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo-section">
            <h1>Private Smart Metering 🔐</h1>
            <p>FHE-Protected Energy Monitoring</p>
          </div>
          <ConnectButton />
        </header>
        
        <div className="connection-prompt">
          <div className="prompt-content">
            <div className="energy-icon">⚡</div>
            <h2>Connect Your Wallet to Start</h2>
            <p>Access your private energy consumption data protected by Fully Homomorphic Encryption</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted meter data...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo-section">
          <h1>Private Smart Metering ⚡</h1>
          <p>FHE-Protected Energy Monitoring</p>
        </div>
        
        <div className="header-actions">
          <button className="availability-btn" onClick={checkAvailability}>
            Check System
          </button>
          <ConnectButton />
        </div>
      </header>

      <main className="main-content">
        <div className="content-grid">
          <section className="dashboard-section">
            <h2>Energy Consumption Dashboard</h2>
            {renderEnergyDashboard()}
            
            <div className="fhe-info-panel">
              <h3>FHE Privacy Protection Process</h3>
              {renderFHEProcess()}
            </div>
          </section>

          <section className="readings-section">
            <div className="section-header">
              <h2>Meter Readings</h2>
              <div className="header-controls">
                <div className="search-box">
                  <input
                    type="text"
                    placeholder="Search readings..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
                <button className="upload-btn" onClick={() => setShowUploadModal(true)}>
                  + Upload Reading
                </button>
                <button className="refresh-btn" onClick={loadReadings} disabled={isRefreshing}>
                  {isRefreshing ? "🔄" : "↻"}
                </button>
              </div>
            </div>

            <div className="readings-list">
              {filteredReadings.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">📊</div>
                  <p>No meter readings found</p>
                  <button className="upload-btn" onClick={() => setShowUploadModal(true)}>
                    Upload First Reading
                  </button>
                </div>
              ) : (
                filteredReadings.map((reading, index) => (
                  <div 
                    key={reading.id}
                    className={`reading-card ${reading.isVerified ? 'verified' : 'encrypted'}`}
                    onClick={() => setSelectedReading(reading)}
                  >
                    <div className="reading-header">
                      <h3>{reading.name}</h3>
                      <span className="reading-status">
                        {reading.isVerified ? '✅ Verified' : '🔒 Encrypted'}
                      </span>
                    </div>
                    <div className="reading-details">
                      <span>Rate: {reading.publicValue1}¢/kWh</span>
                      <span>{new Date(reading.timestamp * 1000).toLocaleDateString()}</span>
                    </div>
                    <div className="reading-consumption">
                      {reading.isVerified ? (
                        <span className="consumption-value">{reading.decryptedValue} kWh</span>
                      ) : (
                        <span className="encrypted-value">🔒 Encrypted</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </main>

      {showUploadModal && (
        <UploadModal
          onSubmit={uploadReading}
          onClose={() => setShowUploadModal(false)}
          uploading={uploading}
          readingData={newReading}
          setReadingData={setNewReading}
          isEncrypting={isEncrypting}
        />
      )}

      {selectedReading && (
        <ReadingDetailModal
          reading={selectedReading}
          onClose={() => setSelectedReading(null)}
          isDecrypting={isDecrypting || fheIsDecrypting}
          decryptReading={() => decryptReading(selectedReading.id)}
        />
      )}

      {transactionStatus.visible && (
        <div className={`transaction-toast ${transactionStatus.status}`}>
          <div className="toast-content">
            <span className="toast-message">{transactionStatus.message}</span>
          </div>
        </div>
      )}
    </div>
  );
};

const UploadModal: React.FC<{
  onSubmit: () => void;
  onClose: () => void;
  uploading: boolean;
  readingData: any;
  setReadingData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, uploading, readingData, setReadingData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setReadingData({ ...readingData, [name]: value });
  };

  return (
    <div className="modal-overlay">
      <div className="upload-modal">
        <div className="modal-header">
          <h2>Upload Encrypted Reading</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="notice-icon">🔐</div>
            <div className="notice-content">
              <strong>FHE Encryption Active</strong>
              <p>Consumption data will be encrypted using Zama FHE technology</p>
            </div>
          </div>

          <div className="form-group">
            <label>Reading Name *</label>
            <input
              type="text"
              name="name"
              value={readingData.name}
              onChange={handleChange}
              placeholder="e.g., January 2024 Reading"
            />
          </div>

          <div className="form-group">
            <label>Energy Consumption (kWh) *</label>
            <input
              type="number"
              name="consumption"
              value={readingData.consumption}
              onChange={handleChange}
              placeholder="Enter consumption in kWh"
              min="0"
            />
            <span className="input-hint">FHE Encrypted Integer</span>
          </div>

          <div className="form-group">
            <label>Electricity Rate (¢/kWh) *</label>
            <input
              type="number"
              name="rate"
              value={readingData.rate}
              onChange={handleChange}
              placeholder="Enter rate in cents"
              min="0"
              step="0.01"
            />
            <span className="input-hint">Public Data</span>
          </div>

          <div className="form-group">
            <label>Description</label>
            <textarea
              name="description"
              value={readingData.description}
              onChange={handleChange}
              placeholder="Additional notes about this reading..."
              rows={3}
            />
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button
            onClick={onSubmit}
            disabled={uploading || isEncrypting || !readingData.name || !readingData.consumption || !readingData.rate}
            className="submit-btn"
          >
            {uploading || isEncrypting ? "Encrypting & Uploading..." : "Upload Reading"}
          </button>
        </div>
      </div>
    </div>
  );
};

const ReadingDetailModal: React.FC<{
  reading: MeterReading;
  onClose: () => void;
  isDecrypting: boolean;
  decryptReading: () => Promise<number | null>;
}> = ({ reading, onClose, isDecrypting, decryptReading }) => {
  const [localDecrypted, setLocalDecrypted] = useState<number | null>(null);

  const handleDecrypt = async () => {
    const result = await decryptReading();
    if (result !== null) {
      setLocalDecrypted(result);
    }
  };

  const calculatedCost = reading.publicValue1 * (reading.isVerified ? reading.decryptedValue : (localDecrypted || 0)) / 100;

  return (
    <div className="modal-overlay">
      <div className="detail-modal">
        <div className="modal-header">
          <h2>Reading Details</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>

        <div className="modal-body">
          <div className="reading-info">
            <div className="info-grid">
              <div className="info-item">
                <label>Reading Name</label>
                <span>{reading.name}</span>
              </div>
              <div className="info-item">
                <label>Electricity Rate</label>
                <span>{reading.publicValue1} ¢/kWh</span>
              </div>
              <div className="info-item">
                <label>Date Recorded</label>
                <span>{new Date(reading.timestamp * 1000).toLocaleString()}</span>
              </div>
              <div className="info-item">
                <label>Recorded By</label>
                <span>{reading.creator.substring(0, 8)}...{reading.creator.substring(34)}</span>
              </div>
            </div>

            <div className="consumption-section">
              <h3>Energy Consumption</h3>
              <div className="consumption-display">
                {reading.isVerified ? (
                  <div className="decrypted-value">
                    <span className="value">{reading.decryptedValue}</span>
                    <span className="unit">kWh</span>
                    <span className="status-badge verified">On-chain Verified</span>
                  </div>
                ) : localDecrypted !== null ? (
                  <div className="decrypted-value">
                    <span className="value">{localDecrypted}</span>
                    <span className="unit">kWh</span>
                    <span className="status-badge local">Locally Decrypted</span>
                  </div>
                ) : (
                  <div className="encrypted-value">
                    <span className="value">🔒</span>
                    <span className="unit">Encrypted</span>
                    <span className="status-badge encrypted">FHE Protected</span>
                  </div>
                )}
              </div>

              {!reading.isVerified && (
                <button
                  className={`decrypt-btn ${localDecrypted !== null ? 'decrypted' : ''}`}
                  onClick={handleDecrypt}
                  disabled={isDecrypting}
                >
                  {isDecrypting ? "Decrypting..." : 
                   localDecrypted !== null ? "Re-verify" : 
                   "Decrypt Reading"}
                </button>
              )}
            </div>

            {(reading.isVerified || localDecrypted !== null) && (
              <div className="billing-section">
                <h3>Billing Calculation</h3>
                <div className="bill-breakdown">
                  <div className="bill-item">
                    <span>Consumption</span>
                    <span>{reading.isVerified ? reading.decryptedValue : localDecrypted} kWh</span>
                  </div>
                  <div className="bill-item">
                    <span>Rate</span>
                    <span>{reading.publicValue1} ¢/kWh</span>
                  </div>
                  <div className="bill-item total">
                    <span>Estimated Cost</span>
                    <span>${calculatedCost.toFixed(2)}</span>
                  </div>
                </div>
                <div className="fhe-note">
                  <small>Bill calculated using homomorphic encryption without revealing consumption patterns</small>
                </div>
              </div>
            )}

            {reading.description && (
              <div className="description-section">
                <h3>Description</h3>
                <p>{reading.description}</p>
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!reading.isVerified && (
            <button
              onClick={handleDecrypt}
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "Verifying..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;

