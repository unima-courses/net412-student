import assert from 'node:assert/strict';
import test from 'node:test';
import { topologyModel, layoutTopology, renderTopology } from '../src/topology/index.js';

test('separates authored device placements without changing their network membership', () => {
  const topology = { networks: [{ id: 'lan', cidr: '10.0.0.0/24' }], devices: [
    { name: 'host_a', networks: ['lan'] }, { name: 'host_b', networks: ['lan'], placement: 'bottom', emphasis: true }, { name: 'server_1', networks: ['lan'], kind: 'server' },
  ] };
  const original = structuredClone(topology);
  const layout = layoutTopology(topology);
  assert.deepEqual(layout.segments[0].top.map(d => d.name), ['host_a', 'server_1']);
  assert.deepEqual(layout.segments[0].bottom.map(d => d.name), ['host_b']);
  assert.deepEqual(topology, original);
});
test('multi-network devices appear on each connected segment; unmatched devices stay visible', () => {
  const topology = { networks: [{ id: 'one' }, { id: 'two' }], devices: [
    { name: 'router', kind: 'router', networks: ['one', 'two'] }, { name: 'client', networks: ['one'] }, { name: 'server', networks: ['two'] }, { name: 'unplugged', networks: ['missing'] },
  ] };
  const layout = layoutTopology(topology);
  assert.deepEqual(layout.segments.map(s => s.top.map(d => d.name)), [['router','client'], ['router','server']]);
  assert.deepEqual(layout.unconnected.map(d => d.name), ['unplugged']);
  assert.match(renderTopology(topology), /Unconnected devices/);
  assert.match(renderTopology(topology), /Shared device/);
});
test('keeps legacy array topologies and empty topologies readable', () => {
  assert.deepEqual(topologyModel([{ name: 'host_a', networks: ['ignored-legacy-value'] }]).devices[0].networks, ['lab']);
  assert.match(renderTopology([{ name: 'host_a' }]), /data-device="host_a"/);
  assert.match(renderTopology(null), /No topology has been supplied/);
});
test('escapes authored device data and renders no invented MAC addresses', () => {
  const html = renderTopology([{ name: '<script>bad</script>', role: '<img src=x onerror=alert(1)>', kind: 'unknown" onclick="bad' }]);
  assert.ok(!html.includes('<script>') && !html.includes('<img'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('topology-mac'));
});
