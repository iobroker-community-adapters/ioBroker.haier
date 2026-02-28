# ioBroker Adapter Development with GitHub Copilot

**Version:** 0.5.7
**Template Source:** https://github.com/DrozmotiX/ioBroker-Copilot-Instructions

This file contains instructions and best practices for GitHub Copilot when working on ioBroker adapter development.

---

## 📑 Table of Contents

1. [Project Context](#project-context)
2. [Code Quality & Standards](#code-quality--standards)
   - [Code Style Guidelines](#code-style-guidelines)
   - [ESLint Configuration](#eslint-configuration)
3. [Testing](#testing)
   - [Unit Testing](#unit-testing)
   - [Integration Testing](#integration-testing)
   - [API Testing with Credentials](#api-testing-with-credentials)
4. [Development Best Practices](#development-best-practices)
   - [Dependency Management](#dependency-management)
   - [HTTP Client Libraries](#http-client-libraries)
   - [Error Handling](#error-handling)
5. [Admin UI Configuration](#admin-ui-configuration)
   - [JSON-Config Setup](#json-config-setup)
   - [Translation Management](#translation-management)
6. [Documentation](#documentation)
   - [README Updates](#readme-updates)
   - [Changelog Management](#changelog-management)
7. [CI/CD & GitHub Actions](#cicd--github-actions)
   - [Workflow Configuration](#workflow-configuration)
   - [Testing Integration](#testing-integration)
8. [Haier Adapter Specific Patterns](#haier-adapter-specific-patterns)
   - [Adapter Lifecycle Management](#adapter-lifecycle-management)
   - [Protocol Handling](#protocol-handling)
   - [Hardware-Specific Considerations](#hardware-specific-considerations)

---

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

---

## Code Quality & Standards

### Code Style Guidelines

- Follow JavaScript/TypeScript best practices
- Use async/await for asynchronous operations
- Implement proper resource cleanup in `unload()` method
- Use semantic versioning for adapter releases
- Include proper JSDoc comments for public methods

**Timer and Resource Cleanup Example:**
```javascript
private connectionTimer?: NodeJS.Timeout;

async onReady() {
  this.connectionTimer = setInterval(() => this.checkConnection(), 30000);
}

onUnload(callback) {
  try {
    if (this.connectionTimer) {
      clearInterval(this.connectionTimer);
      this.connectionTimer = undefined;
    }
    callback();
  } catch (e) {
    callback();
  }
}
```

### ESLint Configuration

**CRITICAL:** ESLint validation must run FIRST in your CI/CD pipeline, before any other tests. This "lint-first" approach catches code quality issues early.

#### Setup
```bash
npm install --save-dev eslint @iobroker/eslint-config
```

#### Configuration (.eslintrc.json)
```json
{
  "extends": "@iobroker/eslint-config",
  "rules": {
    // Add project-specific rule overrides here if needed
  }
}
```

#### Package.json Scripts
```json
{
  "scripts": {
    "lint": "eslint --max-warnings 0 .",
    "lint:fix": "eslint . --fix"
  }
}
```

#### Best Practices
1. ✅ Run ESLint before committing — fix ALL warnings, not just errors
2. ✅ Use `lint:fix` for auto-fixable issues
3. ✅ Don't disable rules without documentation
4. ✅ Lint all relevant files (main code, tests, build scripts)
5. ✅ Keep `@iobroker/eslint-config` up to date
6. ✅ **ESLint warnings are treated as errors in CI** (`--max-warnings 0`). The `lint` script above already includes this flag — run `npm run lint` to match CI behavior locally

#### Common Issues
- **Unused variables**: Remove or prefix with underscore (`_variable`)
- **Missing semicolons**: Run `npm run lint:fix`
- **Indentation**: Use 4 spaces (ioBroker standard)
- **console.log**: Replace with `adapter.log.debug()` or remove

---

## Testing

### Unit Testing

- Use Jest as the primary testing framework
- Create tests for all adapter main functions and helper methods
- Test error handling scenarios and edge cases
- Mock external API calls and hardware dependencies
- For adapters connecting to APIs/devices not reachable by internet, provide example data files

**Example Structure:**
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

**CRITICAL:** Use the official `@iobroker/testing` framework. This is the ONLY correct way to test ioBroker adapters.

**Official Documentation:** https://github.com/ioBroker/testing

#### Haier Adapter Integration Test Example

```javascript
const path = require('path');
const { tests } = require('@iobroker/testing');

const TEST_HOST = '127.0.0.1';
const TEST_PORT = 23;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

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

                        harness.objects.setObject(obj._id, obj);

                        console.log('✅ Step 1: Configuration written, starting adapter...');
                        await harness.startAdapterAndWait();
                        console.log('✅ Step 2: Adapter started');

                        await wait(10000);

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

#### Test Data Management

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

#### Testing Success AND Failure Scenarios

**IMPORTANT:** For every "it works" test, implement corresponding "it fails gracefully" tests.

**Failure Scenario Example:**
```javascript
it('should handle missing host configuration properly', function () {
    return new Promise(async (resolve, reject) => {
        try {
            harness = getHarness();

            const obj = await new Promise((res, rej) => {
                harness.objects.getObject('system.adapter.haier.0', (err, o) => {
                    if (err) return rej(err);
                    res(o);
                });
            });

            if (!obj) return reject(new Error('Adapter object not found'));

            // Remove required host configuration
            delete obj.native.host;

            await new Promise((res, rej) => {
                harness.objects.setObject(obj._id, obj, (err) => {
                    if (err) return rej(err);
                    res(undefined);
                });
            });

            await harness.startAdapterAndWait();
            await new Promise((res) => setTimeout(res, 10000));

            const connectionState = await new Promise((res, rej) => {
                harness.states.getState('haier.0.info.connection', (err, state) => {
                    if (err) return rej(err);
                    res(state);
                });
            });

            if (!connectionState || connectionState.val === false) {
                console.log('✅ Adapter properly failed with missing host configuration');
                resolve(true);
            } else {
                reject(new Error('Adapter should have failed with missing host configuration'));
            }

            await harness.stopAdapter();
        } catch (error) {
            console.log('✅ Adapter correctly threw error with missing configuration:', error.message);
            resolve(true);
        }
    });
}).timeout(40000);
```

#### Key Rules

1. ✅ Use `@iobroker/testing` framework
2. ✅ Configure via `harness.objects.setObject()`
3. ✅ Start via `harness.startAdapterAndWait()`
4. ✅ Verify states via `harness.states.getState()`
5. ✅ Allow proper timeouts for async operations
6. ❌ NEVER test API URLs directly
7. ❌ NEVER bypass the harness system

#### Workflow Dependencies

Integration tests should run ONLY after lint and adapter tests pass:

```yaml
integration-tests:
  needs: [check-and-lint, adapter-tests]
  runs-on: ubuntu-22.04
```

### API Testing with Credentials

For adapters connecting to external APIs requiring authentication:

#### Password Encryption for Integration Tests

```javascript
async function encryptPassword(harness, password) {
    const systemConfig = await harness.objects.getObjectAsync("system.config");
    if (!systemConfig?.native?.secret) {
        throw new Error("Could not retrieve system secret for password encryption");
    }

    const secret = systemConfig.native.secret;
    let result = '';
    for (let i = 0; i < password.length; ++i) {
        result += String.fromCharCode(secret[i % secret.length].charCodeAt(0) ^ password.charCodeAt(i));
    }
    return result;
}
```

#### Demo Credentials Testing Pattern

- Use provider demo credentials when available (e.g., `demo@api-provider.com` / `demo`)
- Create separate test file: `test/integration-demo.js`
- Add npm script: `"test:integration-demo": "mocha test/integration-demo --exit"`
- Implement clear success/failure criteria

**Example Implementation:**
```javascript
it("Should connect to API with demo credentials", async () => {
    const encryptedPassword = await encryptPassword(harness, "demo_password");

    await harness.changeAdapterConfig("your-adapter", {
        native: {
            username: "demo@provider.com",
            password: encryptedPassword,
        }
    });

    await harness.startAdapter();
    await new Promise(resolve => setTimeout(resolve, 60000));

    const connectionState = await harness.states.getStateAsync("your-adapter.0.info.connection");

    if (connectionState?.val === true) {
        console.log("✅ SUCCESS: API connection established");
        return true;
    } else {
        throw new Error("API Test Failed: Expected API connection. Check logs for API errors.");
    }
}).timeout(120000);
```

---

## Development Best Practices

### Dependency Management

- Always use `npm` for dependency management
- Use `npm ci` for installing existing dependencies (respects package-lock.json)
- Use `npm install` only when adding or updating dependencies
- Keep dependencies minimal and focused
- Only update dependencies in separate Pull Requests

**When modifying package.json:**
1. Run `npm install` to sync package-lock.json
2. Commit both package.json and package-lock.json together

**Best Practices:**
- Prefer built-in Node.js modules when possible
- Use `@iobroker/adapter-core` for adapter base functionality
- Avoid deprecated packages
- Document specific version requirements

### HTTP Client Libraries

- **Preferred:** Use native `fetch` API (Node.js 20+ required)
- **Avoid:** `axios` unless specific features are required

**Example with fetch:**
```javascript
try {
  const response = await fetch('https://api.example.com/data');
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  const data = await response.json();
} catch (error) {
  this.log.error(`API request failed: ${error.message}`);
}
```

**Other Recommendations:**
- **Logging:** Use adapter built-in logging (`this.log.*`)
- **Scheduling:** Use adapter built-in timers and intervals
- **File operations:** Use Node.js `fs/promises`
- **Configuration:** Use adapter config system

### Error Handling

- Always catch and log errors appropriately
- Use adapter log levels (error, warn, info, debug)
- Provide meaningful, user-friendly error messages
- Handle network failures gracefully
- Implement retry mechanisms where appropriate
- Always clean up timers, intervals, and resources in `unload()` method

**Example:**
```javascript
try {
  await this.connectToDevice();
} catch (error) {
  this.log.error(`Failed to connect to device: ${error.message}`);
  this.setState('info.connection', false, true);
  // Implement retry logic if needed
}
```

---

## Admin UI Configuration

### JSON-Config Setup

Use JSON-Config format for modern ioBroker admin interfaces.

**Example Structure:**
```json
{
  "type": "panel",
  "items": {
    "host": {
      "type": "text",
      "label": "Host address",
      "help": "IP address or hostname of the device"
    }
  }
}
```

**Guidelines:**
- ✅ Use consistent naming conventions
- ✅ Provide sensible default values
- ✅ Include validation for required fields
- ✅ Add tooltips for complex options
- ✅ Ensure translations for all supported languages (minimum English and German)
- ✅ Write end-user friendly labels, avoid technical jargon

### Translation Management

**CRITICAL:** Translation files must stay synchronized with `admin/jsonConfig.json`. Orphaned keys or missing translations cause UI issues and PR review delays.

#### Overview
- **Location:** `admin/i18n/{lang}/translations.json` for 11 languages (de, en, es, fr, it, nl, pl, pt, ru, uk, zh-cn)
- **Source of truth:** `admin/jsonConfig.json` - all `label` and `help` properties must have translations
- **Command:** `npm run translate` - auto-generates translations but does NOT remove orphaned keys

#### Critical Rules
1. ✅ Keys must match exactly with jsonConfig.json
2. ✅ No orphaned keys in translation files
3. ✅ All translations must be in native language (no English fallbacks)
4. ✅ Keys must be sorted alphabetically

#### Workflow for Translation Updates

**When modifying admin/jsonConfig.json:**

1. Make your changes to labels/help texts
2. Run automatic translation: `npm run translate`
3. Validate and remove orphaned keys manually
4. Run: `npm run lint && npm run test`

#### Translation Checklist

Before committing changes to admin UI or translations:
1. ✅ No orphaned keys in any translation file
2. ✅ All translations in native language
3. ✅ Keys alphabetically sorted
4. ✅ `npm run lint` passes
5. ✅ `npm run test` passes

---

## Documentation

### README Updates

#### Required Sections
1. **Installation** - Clear npm/ioBroker admin installation steps
2. **Configuration** - Detailed configuration options with examples
3. **Usage** - Practical examples and use cases
4. **Changelog** - Version history (use "## **WORK IN PROGRESS**" for ongoing changes)
5. **License** - License information (typically MIT for ioBroker adapters)
6. **Support** - Links to issues, discussions, community support

#### Documentation Standards
- Use clear, concise language
- Include code examples for configuration
- Add screenshots for admin interface when applicable
- Maintain multilingual support (minimum English and German)
- Always reference issues in commits and PRs (e.g., "fixes #xx")

#### Mandatory README Updates for PRs

For **every PR or new feature**, always add a user-friendly entry to README.md:

- Add entries under `## **WORK IN PROGRESS**` section
- Use format: `* (author) **TYPE**: Description of user-visible change`
- Types: **NEW** (features), **FIXED** (bugs), **ENHANCED** (improvements), **TESTING** (test additions), **CI/CD** (automation)
- Focus on user impact, not technical details

**Example:**
```markdown
## **WORK IN PROGRESS**

* (DutchmanNL) **FIXED**: Adapter now properly validates login credentials (fixes #25)
* (DutchmanNL) **NEW**: Added device discovery to simplify initial setup
```

### Changelog Management

Follow the [AlCalzone release-script](https://github.com/AlCalzone/release-script) standard.

#### Format Requirements

```markdown
# Changelog

<!--
  Placeholder for the next version (at the beginning of the line):
  ## **WORK IN PROGRESS**
-->

## **WORK IN PROGRESS**

- (author) **NEW**: Added new feature X
- (author) **FIXED**: Fixed bug Y (fixes #25)

## v0.1.0 (2023-01-01)
Initial release
```

#### Workflow Process
- **During Development:** All changes go under `## **WORK IN PROGRESS**`
- **For Every PR:** Add user-facing changes to WORK IN PROGRESS section
- **Before Merge:** Version number and date added when merging to main
- **Release Process:** Release-script automatically converts placeholder to actual version

#### Change Entry Format
- Format: `- (author) **TYPE**: User-friendly description`
- Types: **NEW**, **FIXED**, **ENHANCED**
- Focus on user impact, not technical implementation
- Reference issues: "fixes #XX" or "solves #XX"

---

## CI/CD & GitHub Actions

### Workflow Configuration

#### GitHub Actions Best Practices

**Must use ioBroker official testing actions:**
- `ioBroker/testing-action-check@v1` for lint and package validation
- `ioBroker/testing-action-adapter@v1` for adapter tests
- `ioBroker/testing-action-deploy@v1` for automated releases with Trusted Publishing (OIDC)

**Configuration:**
- **Node.js versions:** Test on 20.x, 22.x, 24.x
- **Platform:** Use ubuntu-22.04
- **Automated releases:** Deploy to npm on version tags (requires NPM Trusted Publishing)

#### Critical: Lint-First Validation Workflow

**ALWAYS run ESLint checks BEFORE other tests.**

**Workflow Dependency Configuration:**
```yaml
jobs:
  check-and-lint:
    # Runs ESLint and package validation
    # Uses: ioBroker/testing-action-check@v1

  adapter-tests:
    needs: [check-and-lint]  # Wait for linting to pass

  integration-tests:
    needs: [check-and-lint, adapter-tests]  # Wait for both
```

### Testing Integration

#### Hardware-Specific CI/CD for Haier Adapter

Since this adapter requires specific hardware (Haier AC + ESP8266 gateway), implement CI/CD that can test logic without hardware:

```yaml
# Tests protocol parsing without requiring actual hardware
protocol-tests:
  runs-on: ubuntu-22.04

  steps:
    - name: Checkout code
      uses: actions/checkout@v4

    - name: Use Node.js 20.x
      uses: actions/setup-node@v4
      with:
        node-version: 20.x
        cache: 'npm'

    - name: Install dependencies
      run: npm ci

    - name: Run protocol parsing tests
      run: npm run test:protocol
```

#### API Testing in CI/CD

For adapters with external API dependencies:

```yaml
demo-api-tests:
  if: contains(github.event.head_commit.message, '[skip ci]') == false
  runs-on: ubuntu-22.04

  steps:
    - name: Checkout code
      uses: actions/checkout@v4

    - name: Use Node.js 20.x
      uses: actions/setup-node@v4
      with:
        node-version: 20.x
        cache: 'npm'

    - name: Install dependencies
      run: npm ci

    - name: Run demo API tests
      run: npm run test:integration-demo
```

#### Testing Best Practices
- Run credential tests separately from main test suite
- Don't make credential tests required for deployment
- Provide clear failure messages for API issues
- Use appropriate timeouts for external calls (120+ seconds)

---

## Haier Adapter Specific Patterns

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
            await this.initializeAdapter();
            await this.connectToDevice();
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

### Protocol Handling

```javascript
handleDeviceData(data) {
    try {
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

### Configuration Management

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

### Hardware-Specific Considerations

#### ESP8266 Gateway Communication
- Handle connection timeouts gracefully
- Implement reconnection logic for network interruptions
- Parse binary UART data correctly according to Haier protocol
- Validate frame integrity before processing commands

#### Air Conditioning Control Patterns
- Respect temperature limits (16-30°C as defined in io-package.json)
- Handle mode transitions properly (auto/cool/heat/fan/dry/off)
- Implement proper fan speed control (min/mid/max/auto)
- Support swing control for air distribution (off/ud/lr/both)

#### State Synchronization
- Query device status periodically to maintain sync
- Handle unsolicited status updates from the device
- Implement proper acknowledgment of state changes
- Manage connection state indicators properly

#### Hardware Mock Testing
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

#### Logging Best Practices
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
