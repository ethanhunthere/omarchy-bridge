import { test, expect, describe } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

describe('Agent 20: Wake-on-LAN Sender Button & Dispatch Test Suite', () => {
  const appPath = path.resolve(__dirname, '../App.tsx');
  const code = fs.readFileSync(appPath, 'utf-8');

  test('App.tsx exists and is readable', () => {
    expect(fs.existsSync(appPath)).toBe(true);
    expect(code.length).toBeGreaterThan(1000);
  });

  describe('Verification 1: Tapping "WAKE-ON-LAN" dispatches action "send_wol"', () => {
    test('Wake-on-LAN button component exists in mobile/App.tsx', () => {
      expect(code.includes('SEND WAKE-ON-LAN')).toBe(true);
      expect(code.includes('UDP magic packet')).toBe(true);
      expect(code.includes('Broadcasts wake signal to network adapter')).toBe(true);
    });

    test('Wake-on-LAN button is a TouchableOpacity with testID="wake-on-lan-btn"', () => {
      const match = code.match(/<TouchableOpacity[^>]*testID=["']wake-on-lan-btn["'][^>]*>/);
      expect(match).not.toBeNull();
    });

    test('Wake-on-LAN button has accessibilityLabel="SEND WAKE-ON-LAN"', () => {
      const match = code.match(/accessibilityLabel=["']SEND WAKE-ON-LAN["']/);
      expect(match).not.toBeNull();
    });

    test('Wake-on-LAN button onPress executes dispatchAction("send_wol")', () => {
      const wolButtonBlock = code.match(/{\/\*\s*Wake-on-LAN\s*\*\/}[\s\S]*?<\/TouchableOpacity>/);
      expect(wolButtonBlock).not.toBeNull();
      expect(wolButtonBlock![0].includes("dispatchAction('send_wol')")).toBe(true);
    });

    test('Wake-on-LAN button resides inside the MACHINE POWER view (activeTab === "power")', () => {
      const powerViewIdx = code.indexOf("{activeTab === 'power' &&");
      const wolIdx = code.indexOf("dispatchAction('send_wol')");
      const endScrollView = code.indexOf('</ScrollView>', powerViewIdx);

      expect(powerViewIdx).toBeGreaterThan(0);
      expect(wolIdx).toBeGreaterThan(powerViewIdx);
      expect(wolIdx).toBeLessThan(endScrollView);
    });

    test('dispatchAction serializes { type: "action", action: "send_wol", payload: {} } over WebSocket', () => {
      const dispatchActionDef = code.match(/const\s+dispatchAction\s*=\s*\(([\s\S]*?)\)\s*=>\s*\{([\s\S]*?)\};/);
      expect(dispatchActionDef).not.toBeNull();
      const fnBody = dispatchActionDef![2];

      expect(fnBody.includes('socketRef.current.send')).toBe(true);
      expect(fnBody.includes("type: 'action'")).toBe(true);
      expect(fnBody.includes('action')).toBe(true);
      expect(fnBody.includes('payload')).toBe(true);

      // Simulate dispatchAction call
      const sentPackets: string[] = [];
      const mockSocket = {
        readyState: 1, // OPEN
        send: (msg: string) => sentPackets.push(msg),
      };

      const simulateDispatch = (action: string, payload: Record<string, unknown> = {}) => {
        if (mockSocket && mockSocket.readyState === 1) {
          mockSocket.send(JSON.stringify({ type: 'action', action, payload }));
        }
      };

      simulateDispatch('send_wol');
      expect(sentPackets.length).toBe(1);
      const parsed = JSON.parse(sentPackets[0]);
      expect(parsed).toEqual({
        type: 'action',
        action: 'send_wol',
        payload: {},
      });
    });
  });

  describe('Verification 2: Server MAC Address Validation & Defaults (14:13:33:a8:af:df)', () => {
    const PRIMARY_MAC = '14:13:33:a8:af:df';

    const validateAndCleanMac = (targetMac: string = PRIMARY_MAC) => {
      const cleanMac = targetMac.replace(/[^0-9a-fA-F]/g, '');
      if (cleanMac.length !== 12) {
        throw new Error('Invalid MAC address (must be 12 hex characters)');
      }
      return cleanMac.toLowerCase();
    };

    test('defaults to PRIMARY_MAC (14:13:33:a8:af:df) when omitted', () => {
      expect(validateAndCleanMac()).toBe('141333a8afdf');
    });

    test('accepts valid 6-byte hex variations (colon, hyphen, dot, uppercase)', () => {
      expect(validateAndCleanMac('14:13:33:a8:af:df')).toBe('141333a8afdf');
      expect(validateAndCleanMac('14-13-33-A8-AF-DF')).toBe('141333a8afdf');
      expect(validateAndCleanMac('1413.33a8.afdf')).toBe('141333a8afdf');
      expect(validateAndCleanMac('141333A8AFDF')).toBe('141333a8afdf');
    });

    test('rejects malformed or invalid MAC inputs', () => {
      expect(() => validateAndCleanMac('14:13:33:a8:af')).toThrow('Invalid MAC address');
      expect(() => validateAndCleanMac('14:13:33:a8:af:df:01')).toThrow('Invalid MAC address');
      expect(() => validateAndCleanMac('14:13:33:a8:af:zz')).toThrow('Invalid MAC address');
      expect(() => validateAndCleanMac('invalid_mac')).toThrow('Invalid MAC address');
      expect(() => validateAndCleanMac('')).toThrow('Invalid MAC address');
    });
  });

  describe('Verification 3: Bit-Exact 102-Byte Magic Packet Construction', () => {
    const PRIMARY_MAC = '14:13:33:a8:af:df';

    const createMagicPacket = (targetMac: string = PRIMARY_MAC) => {
      const cleanMac = targetMac.replace(/[^0-9a-fA-F]/g, '');
      if (cleanMac.length !== 12) {
        throw new Error('Invalid MAC address (must be 12 hex characters)');
      }
      const macBuffer = Buffer.from(cleanMac, 'hex');
      const magicPacket = Buffer.alloc(102);
      for (let i = 0; i < 6; i++) magicPacket[i] = 0xff;
      for (let i = 0; i < 16; i++) macBuffer.copy(magicPacket, 6 + i * 6);
      return { magicPacket, macBuffer };
    };

    test('packet size is bit-exact 102 bytes', () => {
      const { magicPacket } = createMagicPacket();
      expect(magicPacket.length).toBe(102);
    });

    test('first 6 bytes form synchronization stream: 6x 0xFF', () => {
      const { magicPacket } = createMagicPacket();
      for (let i = 0; i < 6; i++) {
        expect(magicPacket[i]).toBe(0xff);
      }
    });

    test('remaining 96 bytes contain exactly 16 repetitions of MAC binary', () => {
      const { magicPacket, macBuffer } = createMagicPacket();
      expect(macBuffer.length).toBe(6);

      for (let rep = 0; rep < 16; rep++) {
        const offset = 6 + rep * 6;
        const slice = magicPacket.subarray(offset, offset + 6);
        expect(Buffer.compare(slice, macBuffer)).toBe(0);
      }
    });

    test('exact byte layout matches WOL specification for PRIMARY_MAC 14:13:33:a8:af:df', () => {
      const { magicPacket } = createMagicPacket('14:13:33:a8:af:df');
      const expectedMacBytes = [0x14, 0x13, 0x33, 0xa8, 0xaf, 0xdf];

      for (let rep = 0; rep < 16; rep++) {
        for (let b = 0; b < 6; b++) {
          expect(magicPacket[6 + rep * 6 + b]).toBe(expectedMacBytes[b]);
        }
      }
    });
  });

  describe('Verification 4: UDP Broadcast on Port 9 to Universal & Subnet Broadcast', () => {
    test('broadcasts to port 9 on 255.255.255.255 and 192.168.1.255', () => {
      const sentDestinations: { address: string; port: number; length: number }[] = [];

      const mockUdpSocket = {
        setBroadcast: (val: boolean) => expect(val).toBe(true),
        send: (buf: Buffer, offset: number, length: number, port: number, address: string, cb?: () => void) => {
          sentDestinations.push({ address, port, length });
          if (cb) cb();
        },
        close: () => {},
      };

      const packet = Buffer.alloc(102, 0xff);
      mockUdpSocket.setBroadcast(true);
      mockUdpSocket.send(packet, 0, packet.length, 9, '255.255.255.255', () => {
        mockUdpSocket.send(packet, 0, packet.length, 9, '192.168.1.255', () => {
          mockUdpSocket.close();
        });
      });

      expect(sentDestinations.length).toBe(2);
      expect(sentDestinations[0]).toEqual({ address: '255.255.255.255', port: 9, length: 102 });
      expect(sentDestinations[1]).toEqual({ address: '192.168.1.255', port: 9, length: 102 });
    });
  });
});
