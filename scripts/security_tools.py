#!/usr/bin/env python3
"""
Moltbot Security Tools - Defensive Security for Raspberry Pi
Ethical hacking tools for network monitoring and protection
"""

import subprocess
import json
import os
import sys
import socket
import struct
import time
import hashlib
import hmac
import base64
import asyncio
import urllib.request
import urllib.error
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, Dict, List, Any

# ==================== CONFIGURATION ====================

CONFIG_DIR = Path.home() / '.moltbot-security'
CONFIG_FILE = CONFIG_DIR / 'config.json'
KNOWN_DEVICES_FILE = CONFIG_DIR / 'known_devices.json'
HONEYPOT_LOG_FILE = CONFIG_DIR / 'honeypot.log'
TOTP_VAULT_FILE = CONFIG_DIR / 'totp_vault.enc'
BREACH_MONITOR_FILE = CONFIG_DIR / 'breach_monitor.json'

# Ensure config directory exists
CONFIG_DIR.mkdir(exist_ok=True)

# ==================== HELPERS ====================

def load_json(filepath: Path, default: Any = None) -> Any:
    """Load JSON file or return default"""
    try:
        if filepath.exists():
            with open(filepath) as f:
                return json.load(f)
    except:
        pass
    return default if default is not None else {}

def save_json(filepath: Path, data: Any):
    """Save data to JSON file"""
    with open(filepath, 'w') as f:
        json.dump(data, f, indent=2, default=str)

def run_cmd(cmd: str, timeout: int = 30) -> str:
    """Run shell command and return output"""
    try:
        result = subprocess.run(
            cmd, shell=True, capture_output=True,
            text=True, timeout=timeout
        )
        return result.stdout + result.stderr
    except subprocess.TimeoutExpired:
        return "ERROR: Command timed out"
    except Exception as e:
        return f"ERROR: {e}"

def get_local_ip() -> str:
    """Get local IP address"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except:
        return "127.0.0.1"

def get_network_prefix() -> str:
    """Get network prefix (e.g., 192.168.2)"""
    ip = get_local_ip()
    return '.'.join(ip.split('.')[:3])

# ==================== 1. NETWORK MONITOR ====================

class NetworkMonitor:
    """Monitor network for devices and security threats"""

    @staticmethod
    def scan_network(timeout: int = 10) -> List[Dict]:
        """Scan local network for devices"""
        prefix = get_network_prefix()
        devices = []

        # Use arp-scan if available, fallback to ping sweep
        arp_result = run_cmd(f"sudo arp-scan -l 2>/dev/null || echo 'arp-scan not installed'", timeout=30)

        if 'not installed' in arp_result:
            # Fallback: ping sweep + arp table
            for i in range(1, 255):
                ip = f"{prefix}.{i}"
                subprocess.Popen(
                    ['ping', '-c', '1', '-W', '1', ip],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL
                )
            time.sleep(3)
            arp_result = run_cmd("arp -a")

        # Parse results
        for line in arp_result.split('\n'):
            if prefix in line:
                parts = line.split()
                if len(parts) >= 2:
                    ip = None
                    mac = None
                    for part in parts:
                        if prefix in part:
                            ip = part.strip('()')
                        if ':' in part and len(part) == 17:
                            mac = part.lower()
                    if ip and mac:
                        # Try to get hostname
                        hostname = "unknown"
                        try:
                            hostname = socket.gethostbyaddr(ip)[0]
                        except:
                            pass
                        devices.append({
                            'ip': ip,
                            'mac': mac,
                            'hostname': hostname,
                            'seen': datetime.now().isoformat()
                        })

        return devices

    @staticmethod
    def get_known_devices() -> Dict:
        """Get list of known/trusted devices"""
        return load_json(KNOWN_DEVICES_FILE, {'trusted': {}, 'blocked': {}})

    @staticmethod
    def add_known_device(mac: str, name: str, trusted: bool = True):
        """Add device to known list"""
        data = NetworkMonitor.get_known_devices()
        key = 'trusted' if trusted else 'blocked'
        data[key][mac.lower()] = {
            'name': name,
            'added': datetime.now().isoformat()
        }
        save_json(KNOWN_DEVICES_FILE, data)
        return f"OK: Added {name} ({mac}) to {key} devices"

    @staticmethod
    def remove_known_device(mac: str):
        """Remove device from known list"""
        data = NetworkMonitor.get_known_devices()
        mac = mac.lower()
        for key in ['trusted', 'blocked']:
            if mac in data[key]:
                name = data[key][mac].get('name', mac)
                del data[key][mac]
                save_json(KNOWN_DEVICES_FILE, data)
                return f"OK: Removed {name} from {key} devices"
        return f"ERROR: Device {mac} not found"

    @staticmethod
    def check_new_devices() -> List[Dict]:
        """Check for unknown devices on network"""
        devices = NetworkMonitor.scan_network()
        known = NetworkMonitor.get_known_devices()

        unknown = []
        for device in devices:
            mac = device['mac'].lower()
            if mac not in known['trusted'] and mac not in known['blocked']:
                unknown.append(device)

        return unknown

    @staticmethod
    def scan_ports(target_ip: str, ports: str = "common") -> Dict:
        """Scan ports on target IP"""
        if ports == "common":
            port_list = [21, 22, 23, 25, 53, 80, 110, 139, 143, 443, 445, 993, 995, 3306, 3389, 5432, 5900, 8080, 8443]
        elif ports == "full":
            port_list = range(1, 1025)
        else:
            port_list = [int(p) for p in ports.split(',')]

        results = {'open': [], 'closed': 0, 'target': target_ip}

        for port in port_list:
            try:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.settimeout(1)
                result = sock.connect_ex((target_ip, port))
                if result == 0:
                    service = "unknown"
                    try:
                        service = socket.getservbyport(port)
                    except:
                        pass
                    results['open'].append({'port': port, 'service': service})
                else:
                    results['closed'] += 1
                sock.close()
            except:
                pass

        return results

# ==================== 2. HONEYPOT ====================

class Honeypot:
    """Lightweight honeypot to detect intrusion attempts"""

    FAKE_SERVICES = {
        'ssh': 2222,
        'ftp': 2121,
        'http': 8888,
        'telnet': 2323
    }

    @staticmethod
    def log_attempt(service: str, ip: str, data: str = ""):
        """Log intrusion attempt"""
        entry = {
            'timestamp': datetime.now().isoformat(),
            'service': service,
            'source_ip': ip,
            'data': data[:500]  # Limit data size
        }

        with open(HONEYPOT_LOG_FILE, 'a') as f:
            f.write(json.dumps(entry) + '\n')

        return entry

    @staticmethod
    def get_logs(limit: int = 50) -> List[Dict]:
        """Get honeypot logs"""
        logs = []
        try:
            with open(HONEYPOT_LOG_FILE, 'r') as f:
                for line in f:
                    try:
                        logs.append(json.loads(line.strip()))
                    except:
                        pass
        except FileNotFoundError:
            pass

        return logs[-limit:]

    @staticmethod
    def clear_logs():
        """Clear honeypot logs"""
        HONEYPOT_LOG_FILE.unlink(missing_ok=True)
        return "OK: Honeypot logs cleared"

    @staticmethod
    def start_service(service: str) -> str:
        """Start a honeypot service (runs in background)"""
        if service not in Honeypot.FAKE_SERVICES:
            return f"ERROR: Unknown service. Available: {', '.join(Honeypot.FAKE_SERVICES.keys())}"

        port = Honeypot.FAKE_SERVICES[service]
        script = f'''
import socket
import json
from datetime import datetime

def log_attempt(service, ip, data=""):
    entry = {{"timestamp": datetime.now().isoformat(), "service": service, "source_ip": ip, "data": data[:500]}}
    with open("{HONEYPOT_LOG_FILE}", "a") as f:
        f.write(json.dumps(entry) + "\\n")
    print(f"[HONEYPOT] {{service}} attempt from {{ip}}")

sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
sock.bind(("0.0.0.0", {port}))
sock.listen(5)
print(f"[HONEYPOT] {service} listening on port {port}")

while True:
    try:
        conn, addr = sock.accept()
        data = ""
        try:
            conn.settimeout(5)
            if "{service}" == "ssh":
                conn.send(b"SSH-2.0-OpenSSH_7.9p1 Debian-10+deb10u2\\r\\n")
            elif "{service}" == "ftp":
                conn.send(b"220 FTP Server Ready\\r\\n")
            elif "{service}" == "http":
                conn.send(b"HTTP/1.1 200 OK\\r\\nServer: Apache/2.4.41\\r\\n\\r\\n")
            elif "{service}" == "telnet":
                conn.send(b"Login: ")
            data = conn.recv(1024).decode(errors="ignore")
        except:
            pass
        log_attempt("{service}", addr[0], data)
        conn.close()
    except:
        pass
'''

        # Write script and run in background
        script_file = CONFIG_DIR / f'honeypot_{service}.py'
        with open(script_file, 'w') as f:
            f.write(script)

        pid_file = CONFIG_DIR / f'honeypot_{service}.pid'
        run_cmd(f"python3 {script_file} > /dev/null 2>&1 & echo $! > {pid_file}")

        return f"OK: Honeypot {service} started on port {port}"

    @staticmethod
    def stop_service(service: str) -> str:
        """Stop a honeypot service"""
        pid_file = CONFIG_DIR / f'honeypot_{service}.pid'
        if pid_file.exists():
            pid = pid_file.read_text().strip()
            run_cmd(f"kill {pid} 2>/dev/null")
            pid_file.unlink()
            return f"OK: Honeypot {service} stopped"
        return f"ERROR: Honeypot {service} not running"

    @staticmethod
    def status() -> Dict:
        """Get honeypot status"""
        status = {}
        for service in Honeypot.FAKE_SERVICES:
            pid_file = CONFIG_DIR / f'honeypot_{service}.pid'
            if pid_file.exists():
                pid = pid_file.read_text().strip()
                check = run_cmd(f"ps -p {pid} -o pid= 2>/dev/null")
                status[service] = 'running' if pid in check else 'stopped'
            else:
                status[service] = 'stopped'
        return status

# ==================== 3. WIFI SECURITY ====================

class WiFiSecurity:
    """WiFi security auditing tools"""

    @staticmethod
    def get_interface() -> str:
        """Get wireless interface name"""
        result = run_cmd("iw dev | grep Interface | awk '{print $2}'")
        return result.strip().split('\n')[0] if result.strip() else "wlan0"

    @staticmethod
    def audit() -> Dict:
        """Audit WiFi security"""
        iface = WiFiSecurity.get_interface()
        results = {'interface': iface, 'issues': [], 'info': {}}

        # Get current connection info
        iwconfig = run_cmd(f"iwconfig {iface} 2>/dev/null")

        # Parse ESSID
        if 'ESSID:' in iwconfig:
            essid = iwconfig.split('ESSID:"')[1].split('"')[0] if 'ESSID:"' in iwconfig else 'unknown'
            results['info']['ssid'] = essid

        # Check encryption
        if 'Encryption key:off' in iwconfig:
            results['issues'].append("WARNING: WiFi has no encryption!")

        # Get more details from nmcli
        nmcli = run_cmd(f"nmcli -t -f active,ssid,security,signal dev wifi | grep '^yes'")
        if nmcli:
            parts = nmcli.strip().split(':')
            if len(parts) >= 4:
                results['info']['security'] = parts[2] if parts[2] else 'OPEN'
                results['info']['signal'] = parts[3] + '%'

                if 'WEP' in parts[2]:
                    results['issues'].append("CRITICAL: Using WEP encryption (easily crackable)")
                elif not parts[2] or parts[2] == '--':
                    results['issues'].append("CRITICAL: Open network (no encryption)")
                elif 'WPA3' not in parts[2]:
                    results['issues'].append("INFO: Consider upgrading to WPA3 if router supports it")

        # Check for hidden SSID
        if results['info'].get('ssid') == '':
            results['info']['hidden'] = True
            results['issues'].append("INFO: Hidden SSID (provides minimal security)")

        return results

    @staticmethod
    def list_clients() -> List[Dict]:
        """List devices connected to the network"""
        # This requires the Pi to be the AP or have access to router
        # Using ARP table as fallback
        return NetworkMonitor.scan_network()

    @staticmethod
    def scan_networks() -> List[Dict]:
        """Scan for nearby WiFi networks"""
        iface = WiFiSecurity.get_interface()
        result = run_cmd(f"sudo iwlist {iface} scan 2>/dev/null | grep -E 'ESSID|Quality|Encryption'")

        networks = []
        current = {}

        for line in result.split('\n'):
            line = line.strip()
            if 'ESSID:' in line:
                if current:
                    networks.append(current)
                current = {'ssid': line.split('ESSID:"')[1].rstrip('"') if 'ESSID:"' in line else 'hidden'}
            elif 'Quality=' in line:
                # Quality=70/100
                try:
                    quality = line.split('Quality=')[1].split()[0]
                    current['quality'] = quality
                except:
                    pass
            elif 'Encryption key:' in line:
                current['encrypted'] = 'on' in line.lower()

        if current:
            networks.append(current)

        return networks

    @staticmethod
    def detect_deauth() -> str:
        """Start monitoring for deauthentication attacks"""
        # This would require monitor mode which needs specific setup
        return "INFO: Deauth detection requires monitor mode.\nRun: sudo airmon-ng start wlan0"

# ==================== 4. BREACH CHECKER ====================

class BreachChecker:
    """Check for credential breaches via HaveIBeenPwned"""

    HIBP_API = "https://haveibeenpwned.com/api/v3"

    @staticmethod
    def check_email(email: str) -> Dict:
        """Check if email appears in known breaches (requires API key)"""
        # Using the password API which is free
        result = {'email': email, 'breaches': [], 'error': None}

        try:
            # Note: The breaches API requires a paid API key
            # Using a simple check via the password API pattern
            url = f"https://haveibeenpwned.com/api/v3/breachedaccount/{email}"
            req = urllib.request.Request(url, headers={
                'User-Agent': 'Moltbot-Security-Scanner',
                'hibp-api-key': ''  # Would need API key for full check
            })

            # For demo, return info about how to check manually
            result['info'] = f"Check manually at: https://haveibeenpwned.com/account/{email}"
            result['note'] = "Full API access requires HIBP API key ($3.50/month)"

        except urllib.error.HTTPError as e:
            if e.code == 404:
                result['status'] = 'clean'
            else:
                result['error'] = str(e)
        except Exception as e:
            result['error'] = str(e)

        return result

    @staticmethod
    def check_password(password: str) -> Dict:
        """Check if password appears in known breaches (k-anonymity, safe)"""
        # Hash password with SHA1
        sha1 = hashlib.sha1(password.encode()).hexdigest().upper()
        prefix = sha1[:5]
        suffix = sha1[5:]

        result = {'compromised': False, 'count': 0}

        try:
            url = f"https://api.pwnedpasswords.com/range/{prefix}"
            req = urllib.request.Request(url, headers={'User-Agent': 'Moltbot-Security'})
            response = urllib.request.urlopen(req, timeout=10)
            data = response.read().decode()

            for line in data.split('\n'):
                if ':' in line:
                    hash_suffix, count = line.strip().split(':')
                    if hash_suffix == suffix:
                        result['compromised'] = True
                        result['count'] = int(count)
                        break

        except Exception as e:
            result['error'] = str(e)

        return result

    @staticmethod
    def add_monitor(email: str) -> str:
        """Add email to breach monitoring list"""
        data = load_json(BREACH_MONITOR_FILE, {'emails': []})
        if email not in data['emails']:
            data['emails'].append(email)
            save_json(BREACH_MONITOR_FILE, data)
            return f"OK: Added {email} to breach monitoring"
        return f"INFO: {email} already being monitored"

    @staticmethod
    def remove_monitor(email: str) -> str:
        """Remove email from monitoring"""
        data = load_json(BREACH_MONITOR_FILE, {'emails': []})
        if email in data['emails']:
            data['emails'].remove(email)
            save_json(BREACH_MONITOR_FILE, data)
            return f"OK: Removed {email} from monitoring"
        return f"ERROR: {email} not in monitoring list"

    @staticmethod
    def list_monitored() -> List[str]:
        """List monitored emails"""
        data = load_json(BREACH_MONITOR_FILE, {'emails': []})
        return data['emails']

# ==================== 5. TOTP AUTHENTICATOR ====================

class TOTPAuthenticator:
    """TOTP 2FA code generator with encrypted vault"""

    @staticmethod
    def _get_vault_key() -> bytes:
        """Get or create vault encryption key"""
        key_file = CONFIG_DIR / '.vault_key'
        if key_file.exists():
            return key_file.read_bytes()
        else:
            # Generate from machine-specific data
            machine_id = run_cmd("cat /etc/machine-id 2>/dev/null || echo 'moltbot'").strip()
            key = hashlib.pbkdf2_hmac('sha256', machine_id.encode(), b'moltbot-totp', 100000)
            key_file.write_bytes(key)
            key_file.chmod(0o600)
            return key

    @staticmethod
    def _encrypt(data: str) -> bytes:
        """Simple XOR encryption (for demo - use proper crypto in production)"""
        key = TOTPAuthenticator._get_vault_key()
        data_bytes = data.encode()
        encrypted = bytes([data_bytes[i] ^ key[i % len(key)] for i in range(len(data_bytes))])
        return base64.b64encode(encrypted)

    @staticmethod
    def _decrypt(encrypted: bytes) -> str:
        """Decrypt data"""
        key = TOTPAuthenticator._get_vault_key()
        data_bytes = base64.b64decode(encrypted)
        decrypted = bytes([data_bytes[i] ^ key[i % len(key)] for i in range(len(data_bytes))])
        return decrypted.decode()

    @staticmethod
    def _load_vault() -> Dict:
        """Load TOTP vault"""
        if TOTP_VAULT_FILE.exists():
            try:
                encrypted = TOTP_VAULT_FILE.read_bytes()
                return json.loads(TOTPAuthenticator._decrypt(encrypted))
            except:
                pass
        return {'secrets': {}}

    @staticmethod
    def _save_vault(data: Dict):
        """Save TOTP vault"""
        encrypted = TOTPAuthenticator._encrypt(json.dumps(data))
        TOTP_VAULT_FILE.write_bytes(encrypted)
        TOTP_VAULT_FILE.chmod(0o600)

    @staticmethod
    def generate_totp(secret: str, digits: int = 6, interval: int = 30) -> str:
        """Generate TOTP code from secret"""
        # Clean secret (remove spaces, uppercase)
        secret = secret.replace(' ', '').upper()

        # Add padding if needed
        padding = 8 - (len(secret) % 8)
        if padding != 8:
            secret += '=' * padding

        try:
            key = base64.b32decode(secret)
        except:
            return "ERROR: Invalid secret format"

        # Get current time counter
        counter = int(time.time()) // interval
        counter_bytes = struct.pack('>Q', counter)

        # Generate HMAC-SHA1
        hmac_hash = hmac.new(key, counter_bytes, hashlib.sha1).digest()

        # Dynamic truncation
        offset = hmac_hash[-1] & 0x0F
        code = struct.unpack('>I', hmac_hash[offset:offset+4])[0]
        code &= 0x7FFFFFFF
        code %= 10 ** digits

        # Calculate time remaining
        remaining = interval - (int(time.time()) % interval)

        return f"{code:0{digits}d} (expires in {remaining}s)"

    @staticmethod
    def add_secret(name: str, secret: str) -> str:
        """Add TOTP secret to vault"""
        vault = TOTPAuthenticator._load_vault()
        vault['secrets'][name.lower()] = {
            'secret': secret.replace(' ', '').upper(),
            'added': datetime.now().isoformat()
        }
        TOTPAuthenticator._save_vault(vault)
        return f"OK: Added 2FA for {name}"

    @staticmethod
    def remove_secret(name: str) -> str:
        """Remove TOTP secret from vault"""
        vault = TOTPAuthenticator._load_vault()
        if name.lower() in vault['secrets']:
            del vault['secrets'][name.lower()]
            TOTPAuthenticator._save_vault(vault)
            return f"OK: Removed 2FA for {name}"
        return f"ERROR: {name} not found in vault"

    @staticmethod
    def get_code(name: str) -> str:
        """Get current TOTP code for service"""
        vault = TOTPAuthenticator._load_vault()
        if name.lower() in vault['secrets']:
            secret = vault['secrets'][name.lower()]['secret']
            return TOTPAuthenticator.generate_totp(secret)
        return f"ERROR: {name} not found. Add with: /2fa add {name} <secret>"

    @staticmethod
    def list_services() -> List[str]:
        """List all services in vault"""
        vault = TOTPAuthenticator._load_vault()
        return list(vault['secrets'].keys())

# ==================== 6. DNS/PI-HOLE INTEGRATION ====================

class DNSControl:
    """Pi-hole integration for DNS control"""

    PIHOLE_API = "http://localhost/admin/api.php"

    @staticmethod
    def _get_api_token() -> Optional[str]:
        """Get Pi-hole API token"""
        token_file = Path("/etc/pihole/setupVars.conf")
        if token_file.exists():
            content = token_file.read_text()
            for line in content.split('\n'):
                if line.startswith('WEBPASSWORD='):
                    return line.split('=')[1].strip()
        return None

    @staticmethod
    def status() -> Dict:
        """Get Pi-hole status"""
        try:
            url = f"{DNSControl.PIHOLE_API}?summary"
            response = urllib.request.urlopen(url, timeout=5)
            return json.loads(response.read().decode())
        except Exception as e:
            return {'error': str(e), 'installed': False}

    @staticmethod
    def enable() -> str:
        """Enable Pi-hole blocking"""
        token = DNSControl._get_api_token()
        if not token:
            return "ERROR: Pi-hole not installed or no API token"
        try:
            url = f"{DNSControl.PIHOLE_API}?enable&auth={token}"
            urllib.request.urlopen(url, timeout=5)
            return "OK: Pi-hole enabled"
        except Exception as e:
            return f"ERROR: {e}"

    @staticmethod
    def disable(duration: int = 300) -> str:
        """Disable Pi-hole for duration (seconds)"""
        token = DNSControl._get_api_token()
        if not token:
            return "ERROR: Pi-hole not installed or no API token"
        try:
            url = f"{DNSControl.PIHOLE_API}?disable={duration}&auth={token}"
            urllib.request.urlopen(url, timeout=5)
            return f"OK: Pi-hole disabled for {duration}s"
        except Exception as e:
            return f"ERROR: {e}"

    @staticmethod
    def block_domain(domain: str) -> str:
        """Add domain to blacklist"""
        result = run_cmd(f"pihole -b {domain} 2>&1")
        return f"Block {domain}: {result.strip()}" if result else f"OK: Blocked {domain}"

    @staticmethod
    def unblock_domain(domain: str) -> str:
        """Remove domain from blacklist"""
        result = run_cmd(f"pihole -b -d {domain} 2>&1")
        return f"Unblock {domain}: {result.strip()}" if result else f"OK: Unblocked {domain}"

    @staticmethod
    def whitelist_domain(domain: str) -> str:
        """Add domain to whitelist"""
        result = run_cmd(f"pihole -w {domain} 2>&1")
        return f"Whitelist {domain}: {result.strip()}" if result else f"OK: Whitelisted {domain}"

# ==================== 7. VPN (WIREGUARD) ====================

class VPNControl:
    """WireGuard VPN management"""

    WG_CONFIG_DIR = Path("/etc/wireguard")

    @staticmethod
    def status() -> Dict:
        """Get WireGuard status"""
        result = run_cmd("sudo wg show 2>/dev/null")
        if not result.strip() or 'Unable to access' in result:
            return {'installed': False, 'active': False, 'error': 'WireGuard not installed or not running'}

        status = {'installed': True, 'active': True, 'interfaces': []}

        # Parse wg show output
        current_iface = None
        for line in result.split('\n'):
            if line.startswith('interface:'):
                current_iface = {'name': line.split(':')[1].strip(), 'peers': []}
                status['interfaces'].append(current_iface)
            elif 'peer:' in line and current_iface:
                current_iface['peers'].append(line.split(':')[1].strip()[:16] + '...')

        return status

    @staticmethod
    def generate_keys() -> Dict:
        """Generate WireGuard key pair"""
        private_key = run_cmd("wg genkey").strip()
        public_key = run_cmd(f"echo '{private_key}' | wg pubkey").strip()

        return {
            'private_key': private_key,
            'public_key': public_key
        }

    @staticmethod
    def create_peer(name: str, server_public_key: str, endpoint: str, allowed_ips: str = "0.0.0.0/0") -> str:
        """Generate peer configuration"""
        keys = VPNControl.generate_keys()

        config = f"""[Interface]
PrivateKey = {keys['private_key']}
Address = 10.0.0.{hash(name) % 250 + 2}/32
DNS = 1.1.1.1

[Peer]
PublicKey = {server_public_key}
Endpoint = {endpoint}
AllowedIPs = {allowed_ips}
PersistentKeepalive = 25
"""

        # Save config
        config_file = CONFIG_DIR / f"wg-{name}.conf"
        config_file.write_text(config)
        config_file.chmod(0o600)

        return f"""Peer config created: {config_file}

Your public key (add to server):
{keys['public_key']}

To connect:
  sudo wg-quick up {config_file}
"""

    @staticmethod
    def up(interface: str = "wg0") -> str:
        """Bring up WireGuard interface"""
        result = run_cmd(f"sudo wg-quick up {interface} 2>&1")
        return f"WireGuard {interface}: {result.strip()}"

    @staticmethod
    def down(interface: str = "wg0") -> str:
        """Bring down WireGuard interface"""
        result = run_cmd(f"sudo wg-quick down {interface} 2>&1")
        return f"WireGuard {interface}: {result.strip()}"

# ==================== CLI INTERFACE ====================

def print_help():
    """Print help message"""
    help_text = """
MOLTBOT SECURITY TOOLS v1.0.0
========================================

NETWORK MONITOR:
  scan                    - Scan network for devices
  scan ports <ip> [ports] - Scan ports on target
  devices                 - List known devices
  devices add <mac> <name> - Add trusted device
  devices remove <mac>    - Remove device
  alerts                  - Check for unknown devices

HONEYPOT:
  honeypot status         - Show honeypot status
  honeypot start <svc>    - Start honeypot (ssh/ftp/http/telnet)
  honeypot stop <svc>     - Stop honeypot
  honeypot logs [n]       - Show last n logs
  honeypot clear          - Clear logs

WIFI SECURITY:
  wifi audit              - Audit WiFi security
  wifi scan               - Scan nearby networks
  wifi clients            - List connected clients

BREACH CHECKER:
  breach email <email>    - Check email for breaches
  breach password <pass>  - Check password (safe k-anonymity)
  breach monitor <email>  - Add email to monitoring
  breach unmonitor <email> - Remove from monitoring
  breach list             - List monitored emails

2FA AUTHENTICATOR:
  2fa add <name> <secret> - Add TOTP secret
  2fa get <name>          - Get current code
  2fa remove <name>       - Remove secret
  2fa list                - List services

DNS (PI-HOLE):
  dns status              - Pi-hole status
  dns enable              - Enable blocking
  dns disable [seconds]   - Disable temporarily
  dns block <domain>      - Block domain
  dns unblock <domain>    - Unblock domain
  dns whitelist <domain>  - Whitelist domain

VPN (WIREGUARD):
  vpn status              - WireGuard status
  vpn up [interface]      - Connect VPN
  vpn down [interface]    - Disconnect VPN
  vpn newpeer <name> <server_pubkey> <endpoint> - Create peer config

EXAMPLES:
  security_tools.py scan
  security_tools.py scan ports 192.168.2.1
  security_tools.py honeypot start ssh
  security_tools.py breach password MyP@ssw0rd123
  security_tools.py 2fa add github JBSWY3DPEHPK3PXP
  security_tools.py 2fa get github
"""
    print(help_text)

def main():
    if len(sys.argv) < 2:
        print_help()
        return

    cmd = sys.argv[1].lower()
    args = sys.argv[2:]

    # Network Monitor
    if cmd == 'scan':
        if args and args[0] == 'ports':
            if len(args) < 2:
                print("Usage: scan ports <ip> [port_list]")
                return
            target = args[1]
            ports = args[2] if len(args) > 2 else "common"
            result = NetworkMonitor.scan_ports(target, ports)
            print(f"PORT SCAN: {result['target']}")
            print("-" * 40)
            if result['open']:
                for p in result['open']:
                    print(f"  {p['port']}/tcp  OPEN  ({p['service']})")
            else:
                print("  No open ports found")
            print(f"\n{result['closed']} ports closed")
        else:
            devices = NetworkMonitor.scan_network()
            print("NETWORK SCAN")
            print("-" * 50)
            for d in devices:
                print(f"  {d['ip']:15} {d['mac']:17} {d['hostname']}")
            print(f"\nTotal: {len(devices)} devices")

    elif cmd == 'devices':
        if args:
            if args[0] == 'add' and len(args) >= 3:
                print(NetworkMonitor.add_known_device(args[1], ' '.join(args[2:])))
            elif args[0] == 'remove' and len(args) >= 2:
                print(NetworkMonitor.remove_known_device(args[1]))
            else:
                print("Usage: devices add <mac> <name> | devices remove <mac>")
        else:
            known = NetworkMonitor.get_known_devices()
            print("KNOWN DEVICES")
            print("-" * 40)
            print("\nTrusted:")
            for mac, info in known.get('trusted', {}).items():
                print(f"  {mac}  {info.get('name', 'unnamed')}")
            print("\nBlocked:")
            for mac, info in known.get('blocked', {}).items():
                print(f"  {mac}  {info.get('name', 'unnamed')}")

    elif cmd == 'alerts':
        unknown = NetworkMonitor.check_new_devices()
        if unknown:
            print("UNKNOWN DEVICES DETECTED!")
            print("-" * 40)
            for d in unknown:
                print(f"  {d['ip']:15} {d['mac']}")
        else:
            print("No unknown devices found")

    # Honeypot
    elif cmd == 'honeypot':
        if not args:
            print("Usage: honeypot status|start|stop|logs|clear")
            return
        subcmd = args[0]
        if subcmd == 'status':
            status = Honeypot.status()
            print("HONEYPOT STATUS")
            print("-" * 30)
            for svc, state in status.items():
                icon = "●" if state == 'running' else "○"
                print(f"  {icon} {svc}: {state}")
        elif subcmd == 'start' and len(args) > 1:
            print(Honeypot.start_service(args[1]))
        elif subcmd == 'stop' and len(args) > 1:
            print(Honeypot.stop_service(args[1]))
        elif subcmd == 'logs':
            limit = int(args[1]) if len(args) > 1 else 20
            logs = Honeypot.get_logs(limit)
            print(f"HONEYPOT LOGS (last {limit})")
            print("-" * 50)
            for log in logs:
                print(f"  [{log['timestamp'][:19]}] {log['service']:6} from {log['source_ip']}")
        elif subcmd == 'clear':
            print(Honeypot.clear_logs())

    # WiFi
    elif cmd == 'wifi':
        if not args:
            print("Usage: wifi audit|scan|clients")
            return
        subcmd = args[0]
        if subcmd == 'audit':
            result = WiFiSecurity.audit()
            print("WIFI SECURITY AUDIT")
            print("-" * 40)
            for key, val in result.get('info', {}).items():
                print(f"  {key}: {val}")
            print("\nIssues:")
            for issue in result.get('issues', []):
                print(f"  ! {issue}")
            if not result.get('issues'):
                print("  None found")
        elif subcmd == 'scan':
            networks = WiFiSecurity.scan_networks()
            print("NEARBY WIFI NETWORKS")
            print("-" * 40)
            for net in networks:
                lock = "🔒" if net.get('encrypted') else "🔓"
                print(f"  {lock} {net.get('ssid', 'hidden'):20} {net.get('quality', 'N/A')}")
        elif subcmd == 'clients':
            clients = WiFiSecurity.list_clients()
            print("NETWORK CLIENTS")
            print("-" * 50)
            for c in clients:
                print(f"  {c['ip']:15} {c['mac']}")

    # Breach Checker
    elif cmd == 'breach':
        if not args:
            print("Usage: breach email|password|monitor|unmonitor|list")
            return
        subcmd = args[0]
        if subcmd == 'email' and len(args) > 1:
            result = BreachChecker.check_email(args[1])
            print(f"BREACH CHECK: {args[1]}")
            print("-" * 40)
            if result.get('info'):
                print(f"  {result['info']}")
            if result.get('note'):
                print(f"  {result['note']}")
        elif subcmd == 'password' and len(args) > 1:
            result = BreachChecker.check_password(args[1])
            print("PASSWORD CHECK")
            print("-" * 40)
            if result.get('compromised'):
                print(f"  ⚠️  COMPROMISED! Found in {result['count']:,} breaches")
                print("  Recommendation: Change this password immediately!")
            else:
                print("  ✓ Password not found in known breaches")
        elif subcmd == 'monitor' and len(args) > 1:
            print(BreachChecker.add_monitor(args[1]))
        elif subcmd == 'unmonitor' and len(args) > 1:
            print(BreachChecker.remove_monitor(args[1]))
        elif subcmd == 'list':
            emails = BreachChecker.list_monitored()
            print("MONITORED EMAILS")
            print("-" * 30)
            for email in emails:
                print(f"  {email}")
            if not emails:
                print("  None")

    # 2FA
    elif cmd == '2fa':
        if not args:
            print("Usage: 2fa add|get|remove|list")
            return
        subcmd = args[0]
        if subcmd == 'add' and len(args) >= 3:
            print(TOTPAuthenticator.add_secret(args[1], ' '.join(args[2:])))
        elif subcmd == 'get' and len(args) > 1:
            code = TOTPAuthenticator.get_code(args[1])
            print(f"2FA CODE: {args[1]}")
            print("-" * 30)
            print(f"  {code}")
        elif subcmd == 'remove' and len(args) > 1:
            print(TOTPAuthenticator.remove_secret(args[1]))
        elif subcmd == 'list':
            services = TOTPAuthenticator.list_services()
            print("2FA SERVICES")
            print("-" * 30)
            for svc in services:
                print(f"  {svc}")
            if not services:
                print("  None configured")

    # DNS/Pi-hole
    elif cmd == 'dns':
        if not args:
            print("Usage: dns status|enable|disable|block|unblock|whitelist")
            return
        subcmd = args[0]
        if subcmd == 'status':
            status = DNSControl.status()
            print("PI-HOLE STATUS")
            print("-" * 40)
            if status.get('error'):
                print(f"  {status['error']}")
            else:
                print(f"  Status: {'Enabled' if status.get('status') == 'enabled' else 'Disabled'}")
                print(f"  Queries today: {status.get('dns_queries_today', 'N/A')}")
                print(f"  Blocked today: {status.get('ads_blocked_today', 'N/A')}")
                print(f"  Block rate: {status.get('ads_percentage_today', 'N/A')}%")
        elif subcmd == 'enable':
            print(DNSControl.enable())
        elif subcmd == 'disable':
            duration = int(args[1]) if len(args) > 1 else 300
            print(DNSControl.disable(duration))
        elif subcmd == 'block' and len(args) > 1:
            print(DNSControl.block_domain(args[1]))
        elif subcmd == 'unblock' and len(args) > 1:
            print(DNSControl.unblock_domain(args[1]))
        elif subcmd == 'whitelist' and len(args) > 1:
            print(DNSControl.whitelist_domain(args[1]))

    # VPN
    elif cmd == 'vpn':
        if not args:
            print("Usage: vpn status|up|down|newpeer")
            return
        subcmd = args[0]
        if subcmd == 'status':
            status = VPNControl.status()
            print("WIREGUARD STATUS")
            print("-" * 40)
            if not status.get('installed'):
                print(f"  {status.get('error', 'Not installed')}")
            else:
                print(f"  Active: {status.get('active')}")
                for iface in status.get('interfaces', []):
                    print(f"  Interface: {iface['name']}")
                    print(f"    Peers: {len(iface.get('peers', []))}")
        elif subcmd == 'up':
            iface = args[1] if len(args) > 1 else 'wg0'
            print(VPNControl.up(iface))
        elif subcmd == 'down':
            iface = args[1] if len(args) > 1 else 'wg0'
            print(VPNControl.down(iface))
        elif subcmd == 'newpeer' and len(args) >= 4:
            print(VPNControl.create_peer(args[1], args[2], args[3]))

    elif cmd == 'help':
        print_help()

    else:
        print(f"Unknown command: {cmd}")
        print("Run 'security_tools.py help' for usage")

if __name__ == '__main__':
    main()
