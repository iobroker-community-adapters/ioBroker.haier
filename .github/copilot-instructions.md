# ioBroker Adapter Development with GitHub Copilot

**Version:** 0.4.0
**Template Source:** https://github.com/DrozmotiX/ioBroker-Copilot-Instructions

This file contains instructions and best practices for GitHub Copilot when working on ioBroker adapter development.

## Project Context

You are working on an ioBroker adapter. ioBroker is an integration platform for the Internet of Things, focused on building smart home and industrial IoT solutions. Adapters are plugins that connect ioBroker to external systems, devices, or services.

**Adapter-Specific Context:**
- **Adapter Name**: iobroker.haier
- **Primary Function**: Controls Haier air conditioning units via UART protocol with TCP-to-Serial gateway
- **Target Devices**: Haier Lightera series air conditioners
- **Communication Method**: UART over TCP/IP using ESP8266-based gateway
- **Key Features**: Temperature control, operation modes (auto/cool/heat/fan/dry), fan speed control, swing control, remote lock, health mode, fresh air function
- **Hardware Requirements**: ESP8266 TelnetToSerial gateway device for UART communication
- **Configuration**: TCP host/port connection to gateway device (default: 127.0.0.1:23)

## Testing

### Unit Testing
- Use Jest as the primary testing framework for ioBroker adapters
- Create tests for all adapter main functions and helper methods
- Test error handling scenarios and edge cases
- Mock external API calls and hardware dependencies
- For adapters connecting to APIs/devices not reachable by internet, provide example data files to allow testing of functionality without live connections
- Example test structure:
  ```javascript
  describe('AdapterName', () => {
    let adapter;
    
    beforeEach(() => {
      // Setup test adapter instance
    });
    
    test('should initialize correctly', () => {
      // Test adapter initialization
    });
  });
  ```

### Integration Testing

**IMPORTANT**: Use the official `@iobroker/testing` framework for all integration tests. This is the ONLY correct way to test ioBroker adapters.

**Official Documentation**: https://github.com/ioBroker/testing

#### Framework Structure
Integration tests MUST follow this exact pattern:

```javascript
const path = require('path');
const { tests } = require('@iobroker/testing');

// Define test coordinates or configuration
const TEST_HOST = '127.0.0.1';
const TEST_PORT = 23;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Use tests.integration() with defineAdditionalTests
tests.integration(path.join(__dirname, '..'), {
    defineAdditionalTests({ suite }) {
        suite('Test adapter with Haier configuration', (getHarness) => {
            let harness;

            before(() => {
                harness = getHarness();
            });

            it('should configure and start adapter', function () {
                return new Promise(async (resolve, reject) => {
                    try {
                        harness = getHarness();
                        
                        // Get adapter object using promisified pattern
                        const obj = await new Promise((res, rej) => {
                            harness.objects.getObject('system.adapter.haier.0', (err, o) => {
                                if (err) return rej(err);
                                res(o);
                            });
                        });
                        
                        if (!obj) {
                            return reject(new Error('Adapter object not found'));
                        }

                        // Configure adapter properties for Haier
                        Object.assign(obj.native, {
                            host: TEST_HOST,
                            port: TEST_PORT,
                        });

                        // Set the updated configuration
                        harness.objects.setObject(obj._id, obj);

                        console.log('✅ Step 1: Configuration written, starting adapter...');
                        
                        // Start adapter and wait
                        await harness.startAdapterAndWait();
                        
                        console.log('✅ Step 2: Adapter started');

                        // Wait for adapter to attempt connection
                        const waitMs = 10000;
                        await wait(waitMs);

                        console.log('🔍 Step 3: Checking states after adapter run...');
                        
                        // Validate connection state exists (even if false due to no hardware)
                        const connectionState = await new Promise((res, rej) => {
                            harness.states.getState('haier.0.info.connection', (err, state) => {
                                if (err) return rej(err);
                                res(state);
                            });
                        });

                        if (!connectionState) {
                            return reject(new Error('Connection state not created'));
                        }

                        console.log('✅ Step 4: Connection state validated');

                        // Test temperature state creation
                        const tempState = await new Promise((res, rej) => {
                            harness.states.getState('haier.0.temp', (err, state) => {
                                if (err) return rej(err);
                                res(state);
                            });
                        });

                        if (tempState === null) {
                            return reject(new Error('Temperature state should be created during initialization'));
                        }

                        resolve();
                    } catch (error) {
                        console.error('Integration test failed:', error);
                        reject(error);
                    }
                });
            }).timeout(30000);
        });
    }
});
```

#### Practical Examples

Based on the Haier adapter's UART communication needs:

**Testing Communication Without Hardware:**
```javascript
// Mock hardware responses for testing
const MOCK_HAIER_RESPONSES = {
    temperature: Buffer.from([0x7e, 0x01, 0x03, 0x18, 0x7f]), // Mock temp response
    power_on: Buffer.from([0x7e, 0x01, 0x01, 0x01, 0x7f]),    // Mock power on
    mode_cool: Buffer.from([0x7e, 0x01, 0x05, 0x01, 0x7f])    // Mock cooling mode
};

suite('Haier Protocol Tests', (getHarness) => {
    it('should parse temperature data correctly', () => {
        // Test parsing logic with mock data
        const temp = parseTemperature(MOCK_HAIER_RESPONSES.temperature);
        expect(temp).toBe(24); // Expected parsed temperature
    });
});
```

### Test Data Management

For the Haier adapter, create test fixtures for various scenarios:

```javascript
// test/fixtures/haier-responses.json
{
  "power_states": {
    "on": [126, 1, 1, 1, 127],
    "off": [126, 1, 1, 0, 127]
  },
  "temperature_readings": {
    "18_degrees": [126, 1, 3, 18, 127],
    "25_degrees": [126, 1, 3, 25, 127],
    "30_degrees": [126, 1, 3, 30, 127]
  },
  "mode_responses": {
    "auto": [126, 1, 5, 0, 127],
    "cool": [126, 1, 5, 1, 127],
    "heat": [126, 1, 5, 2, 127],
    "fan": [126, 1, 5, 3, 127],
    "dry": [126, 1, 5, 4, 127]
  }
}
```

## ioBroker Adapter Development Patterns

### Adapter Lifecycle Management

```javascript
class HaierAdapter extends utils.Adapter {
    constructor(options = {}) {
        super({
            ...options,
            name: 'haier',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload', this.onUnload.bind(this));
        
        // Initialize connection properties
        this.connection = null;
        this.connectionTimer = null;
        this.isConnected = false;
    }

    async onReady() {
        try {
            // Initialize adapter configuration
            await this.initializeAdapter();
            
            // Set up connection to Haier device via TCP gateway
            await this.connectToDevice();
            
            // Subscribe to state changes for writeable states
            this.subscribeStates('*');
            
        } catch (error) {
            this.log.error(`Failed to initialize: ${error.message}`);
        }
    }

    async connectToDevice() {
        const host = this.config.host || '127.0.0.1';
        const port = this.config.port || 23;
        
        try {
            this.connection = new net.Socket();
            
            this.connection.on('connect', () => {
                this.log.info(`Connected to Haier device at ${host}:${port}`);
                this.setState('info.connection', true, true);
                this.isConnected = true;
            });
            
            this.connection.on('data', (data) => {
                this.handleDeviceData(data);
            });
            
            this.connection.on('error', (error) => {
                this.log.error(`Connection error: ${error.message}`);
                this.setState('info.connection', false, true);
                this.isConnected = false;
                this.scheduleReconnect();
            });
            
            this.connection.connect(port, host);
            
        } catch (error) {
            this.log.error(`Failed to connect to device: ${error.message}`);
            this.setState('info.connection', false, true);
            this.scheduleReconnect();
        }
    }
}
```

### State Management

```javascript
async onStateChange(id, state) {
    if (!state || state.ack) return;
    
    try {
        const stateName = id.split('.').pop();
        
        switch (stateName) {
            case 'power':
                await this.setPowerState(state.val);
                break;
            case 'settemp':
                await this.setTemperature(state.val);
                break;
            case 'mode':
                await this.setMode(state.val);
                break;
            case 'fanspeed':
                await this.setFanSpeed(state.val);
                break;
            // Handle other controls...
        }
        
        // Acknowledge the state change
        this.setState(id, state.val, true);
        
    } catch (error) {
        this.log.error(`Failed to handle state change for ${id}: ${error.message}`);
    }
}
```

### Error Handling and Recovery

```javascript
scheduleReconnect() {
    if (this.connectionTimer) {
        clearTimeout(this.connectionTimer);
    }
    
    this.connectionTimer = setTimeout(() => {
        this.log.info('Attempting to reconnect to Haier device...');
        this.connectToDevice();
    }, 30000); // Retry after 30 seconds
}

async onUnload(callback) {
    try {
        if (this.connectionTimer) {
            clearTimeout(this.connectionTimer);
            this.connectionTimer = null;
        }
        
        if (this.connection && this.connection.readyState === 'open') {
            this.connection.destroy();
        }
        
        this.setState('info.connection', false, true);
        
        callback();
    } catch (error) {
        callback();
    }
}
```

### Protocol Handling for Haier Devices

```javascript
handleDeviceData(data) {
    try {
        // Haier protocol parsing based on the specific UART format
        const buffer = Buffer.from(data);
        
        if (buffer.length < 5) {
            this.log.warn('Received incomplete data from Haier device');
            return;
        }
        
        // Check for valid frame (starts with 0x7e, ends with 0x7f)
        if (buffer[0] !== 0x7e || buffer[buffer.length - 1] !== 0x7f) {
            this.log.warn('Received invalid frame from Haier device');
            return;
        }
        
        const command = buffer[1];
        const subcommand = buffer[2];
        const value = buffer[3];
        
        switch (command) {
            case 0x01: // Status update
                this.handleStatusUpdate(subcommand, value);
                break;
            case 0x02: // Temperature data
                this.handleTemperatureData(value);
                break;
            // Add other command handlers...
        }
        
    } catch (error) {
        this.log.error(`Failed to parse device data: ${error.message}`);
    }
}

async sendCommand(command, subcommand, value) {
    if (!this.isConnected || !this.connection) {
        this.log.warn('Cannot send command: not connected to device');
        return false;
    }
    
    try {
        // Build Haier protocol frame
        const frame = Buffer.from([0x7e, command, subcommand, value, 0x7f]);
        
        this.connection.write(frame);
        this.log.debug(`Sent command: ${frame.toString('hex')}`);
        
        return true;
    } catch (error) {
        this.log.error(`Failed to send command: ${error.message}`);
        return false;
    }
}
```

## Configuration Management

### JSON Config Structure

The Haier adapter uses simple host/port configuration:

```javascript
// Expected in io-package.json native section:
{
    "native": {
        "host": "127.0.0.1",
        "port": 23
    }
}
```

### Configuration Validation

```javascript
validateConfiguration() {
    const config = this.config;
    
    if (!config.host) {
        this.log.error('Host configuration is required');
        return false;
    }
    
    if (!config.port || config.port < 1 || config.port > 65535) {
        this.log.error('Valid port configuration is required (1-65535)');
        return false;
    }
    
    return true;
}
```

## Logging Best Practices

```javascript
// Use appropriate log levels
this.log.error('Critical errors that prevent operation');
this.log.warn('Important warnings that may affect functionality'); 
this.log.info('General operational information');
this.log.debug('Detailed debugging information');

// Log with context for better debugging
this.log.debug(`Received data from ${host}:${port}: ${data.toString('hex')}`);

// Log state changes for troubleshooting
this.log.info(`Power state changed to: ${state ? 'ON' : 'OFF'}`);
```

## Code Style and Standards

- Follow JavaScript/TypeScript best practices
- Use async/await for asynchronous operations
- Implement proper resource cleanup in `unload()` method
- Use semantic versioning for adapter releases
- Include proper JSDoc comments for public methods

## Hardware-Specific Considerations

### ESP8266 Gateway Communication
- Handle connection timeouts gracefully
- Implement reconnection logic for network interruptions
- Parse binary UART data correctly according to Haier protocol
- Validate frame integrity before processing commands

### Air Conditioning Control Patterns
- Respect temperature limits (16-30°C as defined in io-package.json)
- Handle mode transitions properly (auto/cool/heat/fan/dry/off)
- Implement proper fan speed control (min/mid/max/auto)
- Support swing control for air distribution (off/ud/lr/both)

### State Synchronization
- Query device status periodically to maintain sync
- Handle unsolicited status updates from the device
- Implement proper acknowledgment of state changes
- Manage connection state indicators properly

## CI/CD and Testing Integration

### GitHub Actions for Hardware Testing
Since this adapter requires specific hardware (Haier AC + ESP8266 gateway), implement CI/CD that can test logic without hardware:

```yaml
# Tests protocol parsing without requiring actual hardware
protocol-tests:
  runs-on: ubuntu-22.04
  
  steps:
    - name: Checkout code
      uses: actions/checkout@v4
      
    - name: Use Node.js 18.x
      uses: actions/setup-node@v4
      with:
        node-version: 18.x
        cache: 'npm'
        
    - name: Install dependencies
      run: npm ci
      
    - name: Run protocol parsing tests
      run: npm run test:protocol
```

### Hardware Mock Testing
```javascript
// Create mock TCP server for testing
const mockHaierServer = net.createServer((socket) => {
    socket.on('data', (data) => {
        // Echo back appropriate responses based on commands
        const response = generateMockResponse(data);
        socket.write(response);
    });
});
```

This adapter requires careful handling of binary UART protocols, network communication, and real-time device control. Focus on robust error handling, connection management, and proper protocol implementation when developing features or fixing issues.