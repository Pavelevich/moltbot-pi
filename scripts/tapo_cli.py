#!/usr/bin/env python3
"""
ClauCapt - Smart Home CLI
Captain of your smart home fleet

Author: Pavelevich
GitHub: https://github.com/Pavelevich/tapo-smart-home-cli
License: MIT

An extensible CLI for controlling smart home devices.
Community contributions welcome!

Currently supports:
  - Lights, plugs, hubs, and sensors
  - More device types coming with community help!
"""
import asyncio
import json
import sys
from pathlib import Path
from datetime import datetime

__version__ = "2.0.0"
__author__ = "Pavelevich"

# Try to import tapo library (for lights/plugs)
try:
    from tapo import ApiClient
    TAPO_AVAILABLE = True
except ImportError:
    TAPO_AVAILABLE = False

# Try to import python-kasa (for H200 hub) - requires Python 3.11+
try:
    from kasa import Discover
    KASA_AVAILABLE = True
except ImportError:
    KASA_AVAILABLE = False

CONFIG_FILE = Path.home() / ".tapo_config.json"

# Default configuration template
DEFAULT_CONFIG = {
    "email": "",
    "password": "",
    "devices": {},
    "hubs": {},
    "cameras": {}
}


def load_config():
    """Load configuration from file or create default"""
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE) as f:
            config = json.load(f)
            if "hubs" not in config:
                config["hubs"] = {}
            if "cameras" not in config:
                config["cameras"] = {}
            return config
    else:
        save_config(DEFAULT_CONFIG)
        print(f"Configuration file created at: {CONFIG_FILE}")
        print("Please edit it with your TAPO credentials.")
        return DEFAULT_CONFIG


def save_config(config):
    """Save configuration to file"""
    with open(CONFIG_FILE, 'w') as f:
        json.dump(config, f, indent=2)


def check_credentials(config):
    """Check if credentials are configured"""
    if not config.get("email") or not config.get("password"):
        print("ERROR: TAPO credentials not configured")
        print(f"Please edit {CONFIG_FILE} with your email and password")
        return False
    return True


async def get_device(config, device_name):
    """Connect to a light/plug by name using tapo library"""
    if not TAPO_AVAILABLE:
        print("ERROR: 'tapo' library not installed")
        print("Run: pip install tapo")
        return None

    if device_name not in config["devices"]:
        print(f"ERROR: Device '{device_name}' not found")
        print(f"Available devices: {list(config['devices'].keys())}")
        return None

    dev = config["devices"][device_name]
    ip = dev["ip"]
    dtype = dev["type"]

    client = ApiClient(config["email"], config["password"])

    try:
        device_methods = {
            "l510": client.l510,
            "l520": client.l520,
            "l530": client.l530,
            "l630": client.l630,
            "p100": client.p100,
            "p110": client.p110,
            "p115": client.p115,
        }

        method = device_methods.get(dtype, client.generic_device)
        return await asyncio.wait_for(method(ip), timeout=10)
    except asyncio.TimeoutError:
        print(f"ERROR: Timeout connecting to {device_name} ({ip})")
        return None
    except Exception as e:
        print(f"ERROR: {e}")
        return None


async def get_hub_kasa(config, hub_name):
    """Connect to H200 hub using python-kasa (requires Python 3.11+)"""
    if not KASA_AVAILABLE:
        print("ERROR: 'python-kasa' library not installed or Python < 3.11")
        print("H200 hub requires Python 3.11+ and python-kasa>=0.8.0")
        print("Run: pip install python-kasa")
        return None

    if hub_name not in config.get("hubs", {}):
        print(f"ERROR: Hub '{hub_name}' not found")
        print(f"Available hubs: {list(config.get('hubs', {}).keys())}")
        return None

    hub_info = config["hubs"][hub_name]
    ip = hub_info["ip"]

    try:
        device = await Discover.discover_single(
            ip,
            username=config["email"],
            password=config["password"]
        )
        await device.update()
        return device
    except Exception as e:
        print(f"ERROR connecting to hub: {e}")
        return None


# ==================== DEVICE COMMANDS ====================

async def cmd_list(config):
    """List all configured devices"""
    print("CONFIGURED TAPO DEVICES:")
    print("-" * 50)

    if config["devices"]:
        print("\nLIGHTS & PLUGS:")
        for name, dev in config["devices"].items():
            print(f"  {name}: {dev['ip']} ({dev['type']})")

    if config.get("hubs"):
        print("\nHUBS (with sensors):")
        for name, hub in config["hubs"].items():
            model = hub.get("model", "H200")
            print(f"  {name}: {hub['ip']} ({model})")
            if hub.get("sensors"):
                for sensor_name, sensor in hub["sensors"].items():
                    print(f"    - {sensor_name}: {sensor['type']} ({sensor.get('model', 'unknown')})")

    if config.get("cameras"):
        print("\nCAMERAS:")
        for name, cam in config["cameras"].items():
            print(f"  {name}: {cam['ip']}")

    if not config["devices"] and not config.get("hubs") and not config.get("cameras"):
        print("\nNo devices configured.")
        print("Use 'tapo add <name> <ip> <type>' to add a device.")
        print("Use 'tapo scan' to discover devices on your network.")


async def cmd_info(config, device_name):
    """Show device information"""
    if not check_credentials(config):
        return

    device = await get_device(config, device_name)
    if not device:
        return

    info = await device.get_device_info()

    print(f"DEVICE: {device_name}")
    print("-" * 40)

    attrs = ['nickname', 'model', 'type', 'device_on', 'brightness',
             'color_temp', 'on_time', 'overheated', 'rssi']

    for attr in attrs:
        if hasattr(info, attr):
            val = getattr(info, attr)
            if val is not None:
                name = attr.replace('_', ' ').title()
                if attr == 'device_on':
                    val = 'ON' if val else 'OFF'
                elif attr == 'brightness':
                    val = f'{val}%'
                elif attr == 'on_time':
                    hours = val // 3600
                    minutes = (val % 3600) // 60
                    val = f'{hours}h {minutes}m'
                print(f"  {name}: {val}")


async def cmd_on(config, device_name):
    """Turn device on"""
    if not check_credentials(config):
        return

    device = await get_device(config, device_name)
    if device:
        await device.on()
        print(f"OK: {device_name} turned ON")


async def cmd_off(config, device_name):
    """Turn device off"""
    if not check_credentials(config):
        return

    device = await get_device(config, device_name)
    if device:
        await device.off()
        print(f"OK: {device_name} turned OFF")


async def cmd_toggle(config, device_name):
    """Toggle device on/off"""
    if not check_credentials(config):
        return

    device = await get_device(config, device_name)
    if device:
        info = await device.get_device_info()
        if info.device_on:
            await device.off()
            print(f"OK: {device_name} turned OFF")
        else:
            await device.on()
            print(f"OK: {device_name} turned ON")


async def cmd_brightness(config, device_name, level):
    """Set device brightness"""
    if not check_credentials(config):
        return

    device = await get_device(config, device_name)
    if device:
        await device.set_brightness(int(level))
        print(f"OK: {device_name} brightness set to {level}%")


async def cmd_color_temp(config, device_name, temp):
    """Set color temperature (2500-6500K)"""
    if not check_credentials(config):
        return

    device = await get_device(config, device_name)
    if device:
        await device.set_color_temperature(int(temp))
        print(f"OK: {device_name} color temperature set to {temp}K")


async def cmd_scan(config):
    """Scan network for devices"""
    import subprocess

    print("SCANNING NETWORK...")
    print("-" * 40)

    result = subprocess.run(['arp', '-a'], capture_output=True, text=True)

    tapo_keywords = ['tapo', 'l510', 'l530', 'l520', 'l630', 'p100', 'p110', 'p115',
                     'h100', 'h200', 'c200', 'c310', 'c210', 't100', 't110', 't300', 't310', 't315']
    found = []

    for line in result.stdout.split('\n'):
        if '192.168' in line or '10.' in line or '172.' in line:
            lower = line.lower()
            is_tapo = any(kw in lower for kw in tapo_keywords)
            if is_tapo:
                print(f"  [TAPO] {line}")
                found.append(line)
            else:
                print(f"  {line}")

    print("-" * 40)
    print(f"Potential TAPO devices found: {len(found)}")

    if found:
        print("\nTo add a device, use:")
        print("  tapo add <name> <ip> <type>")
        print("\nDevice types: l510, l520, l530, l630, p100, p110, p115")
        print("For H200 hub: tapo hub-add <name> <ip>")


async def cmd_add(config, name, ip, dtype):
    """Add a new device"""
    valid_types = ['l510', 'l520', 'l530', 'l630', 'p100', 'p110', 'p115']
    if dtype not in valid_types:
        print(f"ERROR: Invalid device type '{dtype}'")
        print(f"Valid types: {', '.join(valid_types)}")
        print("For H200 hub, use: tapo hub-add <name> <ip>")
        return

    config["devices"][name] = {"ip": ip, "type": dtype, "name": name}
    save_config(config)
    print(f"OK: Device '{name}' added ({ip}, {dtype})")


async def cmd_remove(config, name):
    """Remove a device"""
    if name in config["devices"]:
        del config["devices"][name]
        save_config(config)
        print(f"OK: Device '{name}' removed")
    elif name in config.get("hubs", {}):
        del config["hubs"][name]
        save_config(config)
        print(f"OK: Hub '{name}' removed")
    else:
        print(f"ERROR: Device/Hub '{name}' not found")


async def cmd_all_on(config):
    """Turn all devices on"""
    if not check_credentials(config):
        return

    for name in config["devices"].keys():
        await cmd_on(config, name)


async def cmd_all_off(config):
    """Turn all devices off"""
    if not check_credentials(config):
        return

    for name in config["devices"].keys():
        await cmd_off(config, name)


async def cmd_status(config):
    """Show status of all devices"""
    if not check_credentials(config):
        return

    print("STATUS OF ALL DEVICES:")
    print("-" * 50)

    for name in config["devices"].keys():
        device = await get_device(config, name)
        if device:
            info = await device.get_device_info()
            status = "ON" if info.device_on else "OFF"
            brightness = f" ({info.brightness}%)" if hasattr(info, 'brightness') and info.brightness else ""
            print(f"  {name}: {status}{brightness}")

    if config.get("hubs"):
        print("\nSENSORS:")
        for hub_name in config["hubs"].keys():
            await cmd_sensors_status(config, hub_name)


# ==================== HUB COMMANDS (H200 via python-kasa) ====================

async def cmd_hub_add(config, name, ip, model="H200"):
    """Add a new hub"""
    if "hubs" not in config:
        config["hubs"] = {}

    config["hubs"][name] = {"ip": ip, "name": name, "model": model, "sensors": {}}
    save_config(config)
    print(f"OK: Hub '{name}' added ({ip}, {model})")

    if check_credentials(config) and KASA_AVAILABLE:
        print("Searching for connected sensors...")
        await cmd_hub_discover(config, name)
    elif not KASA_AVAILABLE:
        print("NOTE: Install python-kasa for sensor discovery (requires Python 3.11+)")


async def cmd_hub_info(config, hub_name):
    """Show hub information"""
    if not check_credentials(config):
        return

    hub = await get_hub_kasa(config, hub_name)
    if not hub:
        return

    print(f"HUB: {hub_name}")
    print("-" * 40)

    hw_info = hub.hw_info
    print(f"  Name: {hw_info.get('dev_name', 'N/A')}")
    print(f"  Model: {hub.model}")
    print(f"  Firmware: {hw_info.get('sw_ver', 'N/A')}")
    print(f"  Hardware: {hw_info.get('hw_ver', 'N/A')}")
    print(f"  MAC: {hw_info.get('mac', 'N/A')}")
    print(f"  Connected sensors: {len(hub.children)}")

    await hub.protocol.close()


async def cmd_hub_discover(config, hub_name):
    """Discover sensors connected to a hub"""
    if not check_credentials(config):
        return

    hub = await get_hub_kasa(config, hub_name)
    if not hub:
        return

    try:
        print(f"\nSENSORS FOUND IN {hub_name}:")
        print("-" * 50)

        hub_config = config["hubs"][hub_name]
        if "sensors" not in hub_config:
            hub_config["sensors"] = {}

        for child in hub.children:
            alias = child.alias or "Unknown"
            model = child.sys_info.get('model', 'unknown') if hasattr(child, 'sys_info') else 'unknown'

            # Determine sensor type from model
            sensor_type = "unknown"
            model_upper = str(model).upper()
            if 'T100' in model_upper:
                sensor_type = "motion"
            elif 'T110' in model_upper:
                sensor_type = "contact"
            elif 'T300' in model_upper:
                sensor_type = "water"
            elif 'T310' in model_upper or 'T315' in model_upper:
                sensor_type = "temperature"
            elif 'D230' in model_upper or 'C420' in model_upper:
                sensor_type = "camera"
            elif 'KE100' in model_upper:
                sensor_type = "thermostat"
            elif 'S200' in model_upper:
                sensor_type = "switch"

            # Create safe name
            safe_name = alias.lower().replace(' ', '_').replace('-', '_')

            # Get device ID
            device_id = ""
            for feature_name, feature in child.features.items():
                if feature_name == "device_id":
                    device_id = str(feature.value)
                    break

            hub_config["sensors"][safe_name] = {
                "device_id": device_id,
                "model": model,
                "nickname": alias,
                "type": sensor_type
            }

            print(f"  {safe_name}:")
            print(f"    Model: {model}")
            print(f"    Type: {sensor_type}")

            # Show current values
            for feature_name, feature in child.features.items():
                if feature_name in ['temperature', 'humidity', 'is_open', 'water_leak', 'battery_level']:
                    unit = feature.unit if hasattr(feature, 'unit') and feature.unit else ''
                    print(f"    {feature_name}: {feature.value} {unit}")

            print()

        save_config(config)
        print(f"OK: {len(hub_config['sensors'])} sensors saved to configuration")

        await hub.protocol.close()

    except Exception as e:
        print(f"ERROR discovering sensors: {e}")


async def cmd_sensors_status(config, hub_name):
    """Show status of all sensors in a hub"""
    if not check_credentials(config):
        return

    hub = await get_hub_kasa(config, hub_name)
    if not hub:
        return

    try:
        print(f"\n  [{hub_name}] - {len(hub.children)} sensors")

        for child in hub.children:
            alias = child.alias or "Unknown"
            model = child.sys_info.get('model', '') if hasattr(child, 'sys_info') else ''

            status_parts = []

            for feature_name, feature in child.features.items():
                if feature_name == 'temperature':
                    status_parts.append(f"Temp: {feature.value}C")
                elif feature_name == 'humidity':
                    status_parts.append(f"Humidity: {feature.value}%")
                elif feature_name == 'is_open':
                    status_parts.append("OPEN" if feature.value else "Closed")
                elif feature_name == 'water_leak':
                    status_parts.append("LEAK!" if "leak" in str(feature.value).lower() else "Dry")
                elif feature_name == 'battery_level':
                    status_parts.append(f"Bat: {feature.value}%")

            status_str = ", ".join(status_parts) if status_parts else "OK"
            print(f"    {alias} ({model}): {status_str}")

        await hub.protocol.close()

    except Exception as e:
        print(f"    Error reading sensors: {e}")


async def cmd_sensor_read(config, hub_name, sensor_name):
    """Read a specific sensor"""
    if not check_credentials(config):
        return

    hub = await get_hub_kasa(config, hub_name)
    if not hub:
        return

    try:
        # Find sensor by name
        target_alias = sensor_name.replace('_', ' ')

        for child in hub.children:
            alias = child.alias or ""
            safe_alias = alias.lower().replace(' ', '_').replace('-', '_')

            if safe_alias == sensor_name or alias.lower() == target_alias.lower():
                model = child.sys_info.get('model', 'unknown') if hasattr(child, 'sys_info') else 'unknown'

                print(f"SENSOR: {alias}")
                print("-" * 40)
                print(f"  Model: {model}")
                print(f"  Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
                print()

                for feature_name, feature in child.features.items():
                    unit = feature.unit if hasattr(feature, 'unit') and feature.unit else ''
                    value = feature.value

                    # Format specific features
                    if feature_name == 'temperature':
                        print(f"  Temperature: {value} {unit}")
                    elif feature_name == 'humidity':
                        print(f"  Humidity: {value} {unit}")
                    elif feature_name == 'is_open':
                        print(f"  Door/Window: {'OPEN' if value else 'Closed'}")
                    elif feature_name == 'water_leak':
                        print(f"  Water Leak: {value}")
                    elif feature_name == 'battery_level':
                        print(f"  Battery: {value} {unit}")
                    elif feature_name == 'battery_low':
                        if value:
                            print(f"  LOW BATTERY WARNING!")
                    elif feature_name == 'rssi':
                        print(f"  Signal: {value} {unit}")
                    elif feature_name not in ['device_id', 'reboot', 'unpair', 'check_latest_firmware']:
                        print(f"  {feature_name}: {value} {unit}")

                await hub.protocol.close()
                return

        print(f"ERROR: Sensor '{sensor_name}' not found in hub '{hub_name}'")
        print("Available sensors:")
        for child in hub.children:
            safe_alias = (child.alias or "").lower().replace(' ', '_').replace('-', '_')
            print(f"  - {safe_alias}")

        await hub.protocol.close()

    except Exception as e:
        print(f"ERROR reading sensor: {e}")


async def cmd_hub_list(config):
    """List all hubs and their sensors"""
    if not config.get("hubs"):
        print("No hubs configured")
        print("Use: tapo hub-add <name> <ip>")
        return

    print("HUBS AND SENSORS:")
    print("-" * 50)

    for name, hub in config["hubs"].items():
        model = hub.get("model", "H200")
        print(f"\n  {name}: {hub['ip']} ({model})")

        if hub.get("sensors"):
            for sensor_name, sensor in hub["sensors"].items():
                print(f"    - {sensor_name}: {sensor.get('model', 'unknown')} ({sensor['type']})")
        else:
            print("    (no sensors discovered - run hub-discover)")


async def cmd_temperature(config, hub_name=None):
    """Quick command to show temperature from all sensors"""
    if not check_credentials(config):
        return

    if not config.get("hubs"):
        print("No hubs configured")
        return

    hubs_to_check = [hub_name] if hub_name else list(config["hubs"].keys())

    for hname in hubs_to_check:
        hub = await get_hub_kasa(config, hname)
        if not hub:
            continue

        print(f"TEMPERATURE READINGS ({hname}):")
        print("-" * 40)

        found_temp = False
        for child in hub.children:
            for feature_name, feature in child.features.items():
                if feature_name == 'temperature':
                    humidity = None
                    for fn, fv in child.features.items():
                        if fn == 'humidity':
                            humidity = fv.value
                            break

                    hum_str = f", {humidity}% humidity" if humidity else ""
                    print(f"  {child.alias}: {feature.value}C{hum_str}")
                    found_temp = True

        if not found_temp:
            print("  No temperature sensors found")

        await hub.protocol.close()


# ==================== HELP ====================

def print_version():
    """Print version information"""
    print(f"TAPO Smart Home CLI v{__version__}")
    print(f"Author: {__author__}")
    print(f"GitHub: https://github.com/Pavelevich/tapo-smart-home-cli")
    print()
    print("Library status:")
    print(f"  tapo library: {'Available' if TAPO_AVAILABLE else 'Not installed'}")
    print(f"  python-kasa:  {'Available' if KASA_AVAILABLE else 'Not installed (H200 hub requires Python 3.11+)'}")


def print_help():
    """Print help message"""
    print(f"""
TAPO Smart Home CLI v{__version__}
===================================

DEVICES (Lights & Plugs):
  list                    - List all configured devices
  status                  - Status of all devices
  info <device>           - Detailed info
  on <device>             - Turn on
  off <device>            - Turn off
  toggle <device>         - Toggle on/off
  bright <device> N       - Set brightness (0-100)
  color <device> K        - Color temperature (2500-6500)
  add <name> <ip> <type>  - Add device
  remove <name>           - Remove device
  all-on                  - Turn all on
  all-off                 - Turn all off

HUB & SENSORS (H200 - requires Python 3.11+):
  hub-add <name> <ip>     - Add hub H200
  hub-info <name>         - Hub information
  hub-discover <name>     - Discover sensors in hub
  hub-list                - List hubs and sensors
  sensors <hub>           - Sensor status
  sensor <hub> <sensor>   - Read specific sensor
  temp [hub]              - Quick temperature reading

OTHER:
  scan                    - Scan network
  version                 - Show version
  help                    - This help

DEVICE TYPES:
  Light bulbs: l510, l520, l530, l630
  Plugs:       p100, p110, p115
  Hub:         H200 (requires Python 3.11+ and python-kasa)

SENSOR TYPES:
  T100  - Motion sensor
  T110  - Contact sensor (door/window)
  T300  - Water leak sensor
  T310  - Temperature & humidity sensor
  T315  - Temperature & humidity sensor (with display)
  D230  - Battery camera (doorbell)
  KE100 - Thermostatic radiator valve
  S200B - Smart button/switch

EXAMPLES:
  {sys.argv[0]} on living_room
  {sys.argv[0]} bright bedroom 50
  {sys.argv[0]} hub-add home 192.168.1.50
  {sys.argv[0]} sensors home
  {sys.argv[0]} temp

CONFIGURATION:
  Config file: {CONFIG_FILE}
""")


# ==================== MAIN ====================

async def main():
    if not TAPO_AVAILABLE and not KASA_AVAILABLE:
        print("ERROR: No TAPO libraries available")
        print("Run: pip install tapo")
        print("For H200 hub: pip install python-kasa (requires Python 3.11+)")
        return 1

    config = load_config()

    if len(sys.argv) < 2:
        print_help()
        return 0

    cmd = sys.argv[1].lower()

    try:
        # Device commands
        if cmd == "help" or cmd == "-h" or cmd == "--help":
            print_help()
        elif cmd == "version" or cmd == "-v" or cmd == "--version":
            print_version()
        elif cmd == "list":
            await cmd_list(config)
        elif cmd == "status":
            await cmd_status(config)
        elif cmd == "scan":
            await cmd_scan(config)
        elif cmd == "all-on":
            await cmd_all_on(config)
        elif cmd == "all-off":
            await cmd_all_off(config)
        elif cmd == "info" and len(sys.argv) >= 3:
            await cmd_info(config, sys.argv[2])
        elif cmd == "on" and len(sys.argv) >= 3:
            await cmd_on(config, sys.argv[2])
        elif cmd == "off" and len(sys.argv) >= 3:
            await cmd_off(config, sys.argv[2])
        elif cmd == "toggle" and len(sys.argv) >= 3:
            await cmd_toggle(config, sys.argv[2])
        elif cmd == "bright" and len(sys.argv) >= 4:
            await cmd_brightness(config, sys.argv[2], sys.argv[3])
        elif cmd == "color" and len(sys.argv) >= 4:
            await cmd_color_temp(config, sys.argv[2], sys.argv[3])
        elif cmd == "add" and len(sys.argv) >= 5:
            await cmd_add(config, sys.argv[2], sys.argv[3], sys.argv[4])
        elif cmd == "remove" and len(sys.argv) >= 3:
            await cmd_remove(config, sys.argv[2])

        # Hub commands
        elif cmd == "hub-add" and len(sys.argv) >= 4:
            model = sys.argv[4] if len(sys.argv) >= 5 else "H200"
            await cmd_hub_add(config, sys.argv[2], sys.argv[3], model)
        elif cmd == "hub-info" and len(sys.argv) >= 3:
            await cmd_hub_info(config, sys.argv[2])
        elif cmd == "hub-discover" and len(sys.argv) >= 3:
            await cmd_hub_discover(config, sys.argv[2])
        elif cmd == "hub-list":
            await cmd_hub_list(config)
        elif cmd == "sensors" and len(sys.argv) >= 3:
            await cmd_sensors_status(config, sys.argv[2])
        elif cmd == "sensor" and len(sys.argv) >= 4:
            await cmd_sensor_read(config, sys.argv[2], sys.argv[3])
        elif cmd == "temp":
            hub_name = sys.argv[2] if len(sys.argv) >= 3 else None
            await cmd_temperature(config, hub_name)

        else:
            print(f"Unknown command: {cmd}")
            print("Run 'tapo help' for usage information.")
            return 1

    except KeyboardInterrupt:
        print("\nOperation cancelled.")
        return 130
    except Exception as e:
        print(f"ERROR: {e}")
        return 1

    return 0


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
