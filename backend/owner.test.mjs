import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { test } from 'node:test'
import { advanceDelivery, shopStatus } from './domain.mjs'
import { MockShippingProvider } from './shipping.mjs'

test('driver assignment preserves the v2 order state', () => {
  const order = { status: 'FINDING_DRIVER' }
  const driver = { name: 'A', phone: '0900000000', plate: '59A1-000.00' }
  assert.equal(advanceDelivery(order, 'DRIVER_ASSIGNED', driver, 1), true)
  assert.equal(order.status, 'FINDING_DRIVER')
  assert.deepEqual(order.driver, driver)
  assert.equal(advanceDelivery(order, 'DRIVER_ASSIGNED', driver, 2), false)
  assert.equal(advanceDelivery(order, 'DRIVER_ARRIVED', null, 3), true)
  assert.equal(advanceDelivery(order, 'DRIVER_ASSIGNED', driver, 4), false)
})

test('busy duration expires and special day overrides weekly hours in Vietnam', () => {
  const now = Date.parse('2026-11-23T03:00Z')
  const shop = { mode: 'SCHEDULE', busyUntil: now + 900000, week: { 1: { from: '08:00', to: '21:00' } }, overrides: {} }
  assert.equal(shopStatus(shop, now), 'BUSY')
  assert.equal(shopStatus(shop, now + 900000), 'OPEN')
  assert.equal(shopStatus({ ...shop, overrides: { '2026-11-23': null } }, now + 900000), 'CLOSED')
  assert.equal(shopStatus({ ...shop, mode: 'OPEN' }, now), 'BUSY')
})

test('mock returns dispatch contract with COD and both addresses', async () => {
  const request = { orderId: 'o1', pickupAddress: 'Quán', deliveryAddress: 'Khách', cod: 70000, note: 'Gọi trước' }
  const shipment = await new MockShippingProvider().dispatch(request)
  assert.equal(shipment.shipmentId, 'mock-o1')
  assert.deepEqual(shipment.request, { pickupAddress: 'Quán', deliveryAddress: 'Khách', cod: 70000, note: 'Gọi trước' })
  assert.ok(shipment.driver.plate)
})

test('owner API manages menu, kitchen, refund handoff and delivery', { timeout: 10000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'owner-api-'))
  const child = spawn(process.execPath, [new URL('./server.mjs', import.meta.url).pathname], {
    env: { PATH: process.env.PATH, OWNER_DEMO: '1', OWNER_STATE_FILE: join(dir, 'state.json'),
      SHIPPING_WEBHOOK_SECRET: 'test-webhook', INTEGRATION_TOKEN: 'test-integration', PORT: '0' },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const exited = new Promise(resolve => child.once('exit', resolve))
  t.after(async () => {
    child.kill()
    await exited
    await rm(dir, { recursive: true, force: true })
  })
  const base = await new Promise((resolve, reject) => {
    const output = createInterface({ input: child.stdout })
    output.once('line', line => {
      const port = line.match(/listening on (\d+)$/)?.[1]
      if (port) resolve('http://127.0.0.1:' + port)
      else reject(new Error(line))
    })
    child.once('error', reject)
    child.once('exit', code => reject(new Error('Owner server exited with ' + code)))
  })
  async function call(path, { token, body, method = body ? 'POST' : 'GET', status = 200 } = {}) {
    const headers = { 'Content-Type': 'application/json' }
    if (token) headers.Authorization = 'Bearer ' + token
    const response = await fetch(base + path, { method, headers, body: body && JSON.stringify(body) })
    const payload = await response.json()
    assert.equal(response.status, status, JSON.stringify(payload))
    return payload
  }
  const { token } = await call('/owner/login', { body: { password: 'khang-demo' } })
  const integration = 'test-integration'
  const owner = (path, body, status) => call('/owner/' + path, { token, body, status })
  const partner = (path, body, status) => call('/integration/' + path, { token: integration, body, status })
  const action = (id, operation, body = {}, status) => owner('orders/' + id + '/' + operation, body, status)
  await call('/owner/dashboard', { status: 401 })
  const profile = { name: 'Quán test', phone: '0900000000', address: 'Quận 1', latitude: 10.77, longitude: 106.69 }
  await owner('shop/profile', { ...profile, latitude: 91 }, 400)
  assert.equal((await owner('shop/profile', profile)).latitude, 10.77)
  await owner('shop/mode', { mode: 'OPEN' })
  const group = await owner('groups', { name: 'Món chính' })
  const item = { name: 'Bún riêu', groupId: group.id, price: 50000, sizes: [{ name: 'Lớn', surcharge: 10000 }],
    toppings: [{ name: 'Chả', surcharge: 5000, available: false }], available: true }
  await owner('items', { ...item, sizes: [] }, 400)
  const created = await owner('items', item)
  await owner('items/' + created.id, { ...item, available: false })
  const menu = await partner('menu')
  assert.equal(menu.items[0].available, false)
  assert.equal(menu.items[0].toppings[0].available, false)
  assert.equal(menu.shop.longitude, 106.69)
  await call('/owner/groups/' + group.id, { token, method: 'DELETE', status: 409 })

  await owner('vouchers', {}, 404)
  await partner('voucher', {}, 404)
  const newOrder = { id: 'checkout-1', payment: 'COD', address: 'Quận 2', total: 60000,
    lines: [{ name: 'Bún riêu', size: 'Lớn', toppings: [], note: 'Không hành', quantity: 1 }] }
  await owner('shop/mode', { mode: 'BUSY', minutes: 15 })
  await partner('orders', newOrder, 409)
  await owner('shop/mode', { mode: 'OPEN' })
  assert.equal((await partner('orders', newOrder)).status, 'PENDING')
  await partner('orders', newOrder)

  const dashboard = await owner('dashboard')
  assert.equal(dashboard.orders.find(order => order.id === 'demo-1').lines[0].note, 'Dị ứng đậu phộng')
  await action('demo-1', 'dispatch', {}, 409)
  assert.equal((await action('demo-1', 'accept')).status, 'CONFIRMED')
  await action('demo-1', 'pack')
  const dispatched = await action('demo-1', 'dispatch')
  assert.equal(dispatched.status, 'FINDING_DRIVER')
  const webhook = (status, token = 'test-webhook', expected = 200) => call('/shipping/webhook', {
    token, status: expected, body: { status, shipmentId: dispatched.shipmentId },
  })
  await webhook('DRIVER_ARRIVED', 'bad', 401)
  await webhook('DRIVER_ARRIVED')
  await webhook('DRIVER_ARRIVED')
  for (const status of ['PICKED_UP', 'DELIVERING', 'DELIVERED']) {
    assert.equal((await action('demo-1', 'demo-next')).status, status)
  }
  await webhook('PICKED_UP')
  assert.equal((await partner('orders/demo-1')).status, 'DELIVERED')
  assert.equal((await action('demo-2', 'reject', { reason: 'Hết chả' })).refundStatus, 'REQUESTED')
  assert.equal((await partner('orders/demo-2/refund', { status: 'REFUNDED' })).refundStatus, 'REFUNDED')
  const events = await partner('events')
  assert.equal(events.filter(entry => entry.status === 'DRIVER_ARRIVED').length, 1)
  assert.ok(events.some(entry => entry.status === 'CONFIRMED'))
  assert.ok(events.some(entry => entry.type === 'REFUND_REQUESTED' && entry.amount === 70000))
})
