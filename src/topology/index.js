/** Offline, stateless topology rendering: normalize data, lay out segments, render cards. */
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const icons = {
  host: '<rect x="5" y="3" width="22" height="16" rx="1.5"/><path d="M2 23h28l-3-4H5zM12 23h8"/><path d="M9 7h14v8H9z" opacity=".35"/>',
  server: '<rect x="7" y="2" width="18" height="25" rx="2"/><path d="M7 10h18M7 18h18M12 29h8"/><path d="M11 6h1m-1 8h1m-1 8h1M17 6h4m-4 8h4m-4 8h4"/>',
  router: '<ellipse cx="16" cy="8" rx="13" ry="5"/><path d="M3 8v13c0 7 26 7 26 0V8M9 16h14m-3-3 3 3-3 3M23 22H9m3-3-3 3 3 3"/>',
  firewall: '<path d="M4 5h24v22H4zM4 12h24M4 20h24M12 5v7m9 0v8m-9 0v7M4 1h24"/>',
  switch: '<rect x="2" y="7" width="28" height="18" rx="3"/><path d="M7 12h18M7 19h3m4 0h3m4 0h3M11 9l-4 3 4 3m10-6 4 3-4 3"/>',
};
function icon(kind) {
  return `<svg class="topology-icon" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${Object.hasOwn(icons, kind) ? icons[kind] : icons.host}</svg>`;
}

export function topologyModel(topology) {
  const legacy = Array.isArray(topology);
  const suppliedNetworks = legacy ? [] : topology?.networks;
  const networks = suppliedNetworks?.length ? suppliedNetworks.map(network => ({ ...network })) : [{ id: 'lab', label: 'Lab network', cidr: '' }];
  const devices = (legacy ? topology : topology?.devices || []).map(device => ({
    ...device,
    networks: legacy ? ['lab'] : device.networks?.length ? [...device.networks] : networks.length === 1 ? [networks[0].id] : [],
  }));
  return { networks, devices };
}

export function layoutTopology(topology) {
  const model = topologyModel(topology);
  const segments = model.networks.map(network => {
    const members = model.devices.filter(device => device.networks.includes(network.id));
    return { network, top: members.filter(device => device.placement !== 'bottom'), bottom: members.filter(device => device.placement === 'bottom') };
  });
  const unconnected = model.devices.filter(device => !model.networks.some(network => device.networks.includes(network.id)));
  return { ...model, segments, unconnected };
}

function deviceCard(device, networks) {
  const others = device.networks.length > 1 ? device.networks.map(id => networks.find(network => network.id === id)?.label || id).join(' · ') : '';
  return `<article class="topology-card${device.emphasis === true ? ' topology-card--emphasis' : ''}" data-device="${escapeHtml(device.name)}" data-kind="${escapeHtml(device.kind || 'host')}">
    ${icon(device.kind || 'host')}<h3>${escapeHtml(device.name)}</h3>
    ${device.ip ? `<code class="topology-address">${escapeHtml(device.ip)}</code>` : ''}
    ${device.mac ? `<code class="topology-mac">MAC ${escapeHtml(device.mac)}</code>` : ''}
    ${device.role ? `<p class="topology-role">${escapeHtml(device.role)}</p>` : ''}
    ${others ? `<small class="topology-memberships">Shared device · ${escapeHtml(others)}</small>` : ''}
  </article>`;
}
function deviceRow(devices, placement, networks) {
  if (!devices.length) return '';
  return `<div class="topology-row topology-row--${placement}" style="--device-count:${devices.length}">${devices.map(device => `<div class="topology-slot">${deviceCard(device, networks)}<span class="topology-port" aria-hidden="true"></span></div>`).join('')}</div>`;
}

function renderSegmentTopology(topology) {
  const model = layoutTopology(topology);
  if (!model.devices.length) return '<p class="topology-empty">No topology has been supplied for this activity.</p>';
  return `<figure class="topology-diagram" aria-label="Lab topology"><figcaption><span>Lab topology</span><small>Device names match the terminals</small></figcaption>
    ${model.segments.map(({ network, top, bottom }) => {
      const columns = Math.max(top.length, bottom.length, 1);
      return `<section class="topology-segment${bottom.length ? ' has-bottom' : ''}" aria-label="${escapeHtml(network.label || network.id)}"><div class="topology-scroll" tabindex="0" aria-label="${escapeHtml(network.label || network.id)} connections"><div class="topology-stage" style="--topology-min-width:${columns * 146 + (columns - 1) * 18}px">
        ${columns > 3 ? `<p class="topology-scroll-hint">${top.length + bottom.length} devices · scroll horizontally for all connections</p>` : ''}
        ${deviceRow(top, 'top', model.networks)}
        <div class="topology-switch">${icon('switch')}<div><strong>${escapeHtml(network.label || network.id)}</strong>${network.cidr ? `<code>${escapeHtml(network.cidr)}</code>` : ''}</div><span class="topology-lan-label">LAN</span></div>
        ${deviceRow(bottom, 'bottom', model.networks)}
        ${!top.length && !bottom.length ? '<p class="topology-empty">No devices connected.</p>' : ''}
      </div></div></section>`;
    }).join('')}
    ${model.unconnected.length ? `<section class="topology-unconnected"><h3>Unconnected devices</h3><div>${model.unconnected.map(device => deviceCard(device, model.networks)).join('')}</div></section>` : ''}
  </figure>`;
}

// One responsive graph: shared routers are represented exactly once.
export function renderTopology(topology) {
  const model = topologyModel(topology);
  if (model.networks.length < 2) return renderSegmentTopology(topology);
  const width = Math.max(1100, model.devices.length * 275);
  const height = 620;
  const networks = model.networks.map((n, i) => ({ ...n, x: 180 + i * (width - 360) / (model.networks.length - 1), y: 310 }));
  const devices = model.devices.map((d, i) => {
    const memberships = networks.filter(n => d.networks.includes(n.id));
    const peers = model.devices.filter(v => v.networks.length === 1 && v.networks[0] === d.networks[0] && v.placement === d.placement);
    const offset = d.networks.length === 1 ? (peers.indexOf(d) - (peers.length - 1) / 2) * 180 : 0;
    return { ...d, x: memberships.length ? memberships.reduce((v, n) => v + n.x, 0) / memberships.length + offset : (i + 1) * width / (model.devices.length + 1), y: d.networks.length > 1 ? 310 : d.placement === 'bottom' ? 520 : 100 };
  });
  const edges = devices.flatMap(d => networks.filter(n => d.networks.includes(n.id)).map(n => `<line x1="${d.x}" y1="${d.y}" x2="${n.x}" y2="${n.y}" stroke="currentColor" stroke-width="2"/>`)).join('');
  const glyph = (kind, x, y, color = 'var(--lab-maroon, #681c31)') => `<svg x="${x-22}" y="${y-22}" width="44" height="44" viewBox="0 0 32 32" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[kind] || icons.host}</svg>`;
  const nodes = devices.map(d => {
    const kind = Object.hasOwn(icons, d.kind) ? d.kind : 'host';
    const role = d.emphasis ? 'Attacker' : kind === 'router' ? 'Router' : kind === 'server' ? 'Server' : 'Workstation';
    return `<g data-device="${escapeHtml(d.name)}" data-kind="${kind}"><title>${escapeHtml(d.role || role)}${d.networks.length > 1 ? ' — Shared device' : ''}</title><rect x="${d.x-105}" y="${d.y-80}" width="210" height="160" rx="12" fill="var(--lab-surface, #fffaf2)" stroke="${d.emphasis ? 'var(--lab-maroon, #681c31)' : 'currentColor'}" stroke-width="${d.emphasis ? 3 : 1}"/>${glyph(kind,d.x,d.y-48)}<text x="${d.x}" y="${d.y-9}" text-anchor="middle" font-size="20" font-weight="bold">${escapeHtml(d.name)}</text><text x="${d.x}" y="${d.y+13}" text-anchor="middle" font-size="16" fill="var(--lab-maroon, #681c31)">${role}</text>${String(d.ip || '').split(' / ').map((ip,i) => `<text x="${d.x}" y="${d.y+39+i*21}" text-anchor="middle" font-size="16">${escapeHtml(ip)}</text>`).join('')}</g>`;
  }).join('');
  return `<figure class="topology-diagram"><figcaption><span>Network topology</span><small>Lines show network connections</small></figcaption><div class="topology-canvas" aria-label="Network diagram"><svg role="img" aria-label="Network topology: ${escapeHtml(devices.map(d => d.name + ' connected to ' + d.networks.map(id => networks.find(n => n.id === id)?.label || id).join(' and ')).join('; '))}" viewBox="0 0 ${width} ${height}" class="topology-graph">${edges}${networks.map(n => `<g data-network="${escapeHtml(n.id)}"><rect x="${n.x-110}" y="${n.y-65}" width="220" height="130" rx="10" fill="var(--lab-maroon, #681c31)"/>${glyph('switch',n.x,n.y-35,'white')}<text x="${n.x}" y="${n.y+6}" text-anchor="middle" fill="white" font-size="18" font-weight="bold">${escapeHtml(n.label || n.id)}</text><text x="${n.x}" y="${n.y+30}" text-anchor="middle" fill="white" font-size="16">${escapeHtml(n.cidr || '')}</text><text x="${n.x}" y="${n.y+51}" text-anchor="middle" fill="white" font-size="13">Switched network</text></g>`).join('')}${nodes}</svg></div>${devices.some(d => !networks.some(n => d.networks.includes(n.id))) ? '<p>Unconnected devices are shown without links.</p>' : ''}</figure>`;
}
