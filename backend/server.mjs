import express from 'express'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { advanceDelivery, deliveryStatuses, coordinates, integer, reject, scheduleEntry, shopStatus, text } from './domain.mjs'
import { HttpShippingProvider, MockShippingProvider } from './shipping.mjs'
import { integrationsFromEnvironment } from './integrations.mjs'

const demo = process.env.OWNER_DEMO === '1'
const password = process.env.OWNER_PASSWORD || (demo ? 'khang-demo' : '')
const webhookSecret = process.env.SHIPPING_WEBHOOK_SECRET
const integrationToken = process.env.INTEGRATION_TOKEN
if (!password) throw new Error('Set OWNER_PASSWORD or explicitly enable OWNER_DEMO=1')

const statePath = process.env.OWNER_STATE_FILE || 'owner-state.json'
const provider = process.env.SHIPPING_ADAPTER_URL
  ? new HttpShippingProvider(process.env.SHIPPING_PROVIDER, process.env.SHIPPING_ADAPTER_URL, process.env.SHIPPING_ADAPTER_TOKEN)
  : demo ? new MockShippingProvider() : null
const integrations = integrationsFromEnvironment()
const sessions = new Map()
const ordersBeingDispatched = new Set()

function seed() {
  const now = Date.now()
  return {
    shop: {
      name: demo ? 'Quán Bún Riêu' : '', phone: demo ? '0900000000' : '',
      address: demo ? '12 Nguyễn Trãi, TP.HCM' : '',
      ...(demo ? { latitude: 10.767, longitude: 106.692 } : {}), mode: 'SCHEDULE', busyUntil: 0,
      week: Array.from({ length: 7 }, () => ({ from: '08:00', to: '21:00' })),
      overrides: {},
    },
    groups: [], items: [], events: [],
    orders: demo ? ['COD', 'ONLINE'].map((payment, index) => ({
      id: 'demo-' + (index + 1), status: 'PENDING', payment, paid: payment === 'ONLINE',
      total: 70000, address: '25 Lê Lợi, TP.HCM', note: 'Gọi khi đến', createdAt: now, updatedAt: now,
      lines: [{ name: 'Bún riêu', size: 'Tô lớn', toppings: ['Thêm chả'], quantity: 1, note: 'Dị ứng đậu phộng' }],
    })) : [],
  }
}

let state
try {
  state = JSON.parse(readFileSync(statePath, 'utf8'))
} catch (error) {
  if (error.code !== 'ENOENT') throw error
  state = seed()
}

const legacyStatuses = { PREPARING: 'CONFIRMED', DISPATCHED: 'FINDING_DRIVER' }
for (const row of [...state.orders, ...state.events]) {
  if (Object.hasOwn(legacyStatuses, row.status)) row.status = legacyStatuses[row.status]
}
for (const order of state.orders) {
  if (order.status === 'DRIVER_ASSIGNED') order.status = 'FINDING_DRIVER'
}
for (const item of state.items) {
  for (const topping of item.toppings) topping.available ??= true
}

function save() {
  writeFileSync(statePath + '.tmp', JSON.stringify(state, null, 2), { mode: 0o600 })
  renameSync(statePath + '.tmp', statePath)
}

function secureEquals(actual, expected) {
  if (typeof actual !== 'string' || !expected) return false
  const a = Buffer.from(actual)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function bearer(req) {
  return req.headers.authorization?.replace(/^Bearer /, '')
}

async function json(req) {
  let raw = ''
  for await (const chunk of req.setEncoding('utf8')) {
    raw += chunk
    if (Buffer.byteLength(raw) > 65536) reject('Dữ liệu quá lớn', 413)
  }
  try {
    const body = JSON.parse(raw || '{}')
    if (!body || typeof body !== 'object' || Array.isArray(body)) reject('Cần JSON object')
    return body
  } catch {
    reject('JSON không hợp lệ')
  }
}

function event(order, type, data = {}) {
  state.events.push({ id: randomUUID(), orderId: order.id, type, at: Date.now(), ...data })
}

function ownerOrderView(order) {
  const { customerToken, paymentReference, ...visible } = order
  return visible
}

function orderById(id) {
  const order = state.orders.find(row => row.id === id)
  if (!order) reject('Không tìm thấy đơn', 404)
  return order
}

function matching(id, list) {
  const row = list.find(entry => entry.id === id)
  if (!row) reject('Không tìm thấy dữ liệu', 404)
  return row
}

function options(entries, label, minimum, availability = false) {
  if (!Array.isArray(entries) || entries.length < minimum || entries.length > 30) {
    reject(label + ' không hợp lệ')
  }
  const mapped = entries.map(entry => ({
    name: text(entry?.name, label, 80), surcharge: integer(entry?.surcharge, 'Phụ thu'),
    ...(availability ? { available: entry?.available !== false } : {}),
  }))
  if (new Set(mapped.map(entry => entry.name)).size !== mapped.length) reject(label + ' bị trùng')
  return mapped
}

async function ownerOrderAction(order, action, body) {
  const now = Date.now()
  switch (action) {
    case 'accept':
      if (order.status !== 'PENDING') reject('Đơn đã được xử lý', 409)
      order.status = 'CONFIRMED'
      event(order, 'ORDER_STATUS', { status: order.status, message: 'Quán đang chuẩn bị món' })
      break
    case 'reject':
      if (order.status !== 'PENDING') reject('Đơn đã được xử lý', 409)
      order.reason = text(body.reason, 'Lý do từ chối')
      order.status = 'REJECTED'
      event(order, 'ORDER_STATUS', { status: order.status, message: order.reason })
      if (order.paid && order.payment === 'ONLINE') {
        order.refundStatus = 'REQUESTED'
        event(order, 'REFUND_REQUESTED', { amount: order.total })
      }
      break
    case 'pack':
      if (order.status !== 'CONFIRMED') reject('Đơn chưa được xác nhận', 409)
      order.status = 'PACKED'
      break
    case 'dispatch':
      if (!provider) reject('Chưa cấu hình đối tác vận chuyển', 503)
      if (order.status !== 'PACKED' || ordersBeingDispatched.has(order.id)) reject('Đơn chưa sẵn sàng gọi shipper', 409)
      ordersBeingDispatched.add(order.id)
      try {
        const shipment = await provider.dispatch({
          orderId: order.id, pickupAddress: state.shop.address, deliveryAddress: order.address,
          pickupCoordinates: coordinates(state.shop.latitude, state.shop.longitude),
          deliveryCoordinates: order.deliveryCoordinates,
          cod: order.paid ? 0 : order.total, note: order.note,
        })
        const dispatched = { ...order, shipmentId: text(shipment.shipmentId, 'Mã chuyến giao'), status: 'FINDING_DRIVER' }
        if (shipment.driver && advanceDelivery(dispatched, 'DRIVER_ASSIGNED', shipment.driver, now)) {
          event(order, 'ORDER_STATUS', { status: 'DRIVER_ASSIGNED', driver: dispatched.driver })
        }
        Object.assign(order, dispatched)
      } finally {
        ordersBeingDispatched.delete(order.id)
      }
      break
    case 'demo-next': {
      if (!demo) reject('Không tìm thấy thao tác', 404)
      const index = deliveryStatuses.indexOf(order.status)
      const next = deliveryStatuses[index + 1]
      if (index < 0 || !next) reject('Đơn không còn bước giao tiếp theo', 409)
      if (advanceDelivery(order, next, null, now)) event(order, 'ORDER_STATUS', { status: order.status })
      break
    }
    default: reject('Không tìm thấy thao tác', 404)
  }
  order.updatedAt = now
  save()
  return order
}

async function route(req) {
  const url = new URL(req.url, 'http://localhost')
  const [area, resource, id, action] = url.pathname.split('/').slice(1).map(decodeURIComponent)
  const method = req.method
  const now = Date.now()

  if (url.pathname === '/health' && method === 'GET') return { ok: true }
  if (url.pathname === '/owner/login' && method === 'POST') {
    const body = await json(req)
    if (!secureEquals(body.password, password)) reject('Sai mật khẩu chủ quán', 401)
    for (const [token, expires] of sessions) if (expires <= now) sessions.delete(token)
    const token = randomUUID()
    sessions.set(token, now + 12 * 3600_000)
    return { token }
  }

  if (url.pathname === '/shipping/webhook' && method === 'POST') {
    if (!secureEquals(bearer(req), webhookSecret)) reject('Webhook chưa xác thực', 401)
    const body = await json(req)
    text(body.shipmentId, 'Mã chuyến giao')
    const order = state.orders.find(row => row.shipmentId && row.shipmentId === body.shipmentId)
    if (!order) reject('Không tìm thấy chuyến giao', 404)
    if (advanceDelivery(order, body.status, body.driver, now)) {
      event(order, 'ORDER_STATUS', { status: body.status, driver: order.driver })
      save()
    }
    return { ok: true }
  }

  if (area === 'integration') {
    if (!secureEquals(bearer(req), integrationToken)) reject('Chưa xác thực tích hợp', 401)
    if (resource === 'events' && method === 'GET') return state.events
    if (resource === 'orders' && method === 'GET' && id) return orderById(id)
    if (resource === 'orders' && method === 'POST' && id && action === 'refund') {
      const order = orderById(id)
      const body = await json(req)
      if (!['REFUNDED', 'FAILED'].includes(body.status)) reject('Kết quả hoàn tiền không hợp lệ')
      if (order.refundStatus === body.status) return order
      if (!['REQUESTED', 'FAILED'].includes(order.refundStatus)) reject('Đơn không chờ hoàn tiền', 409)
      order.refundStatus = body.status
      event(order, 'REFUND_STATUS', { status: body.status })
      save()
      return order
    }
    if (resource === 'orders' && method === 'POST' && !id) {
      const body = await json(req)
      const orderId = text(body.id, 'Mã đơn', 100)
      const existing = state.orders.find(order => order.id === orderId)
      if (existing) return existing
      if (shopStatus(state.shop, now) !== 'OPEN') reject('Quán chưa nhận đơn', 409)
      if (!Array.isArray(body.lines) || !body.lines.length || body.lines.length > 100) reject('Thiếu dòng món')
      if (!['COD', 'ONLINE'].includes(body.payment) || (body.payment === 'ONLINE' && body.paid !== true)) {
        reject('Trạng thái thanh toán không hợp lệ')
      }
      const lines = body.lines.map(line => ({
        name: text(line?.name, 'Tên món'), size: text(line?.size, 'Kích cỡ'),
        toppings: options(Array.isArray(line?.toppings) ? line.toppings.map(name => ({ name, surcharge: 0 })) : null, 'Món thêm', 0).map(row => row.name),
        quantity: integer(line?.quantity, 'Số lượng', 1, 100), note: String(line?.note ?? '').slice(0, 500),
      }))
      const order = {
        id: orderId, status: 'PENDING', payment: body.payment, paid: body.payment === 'ONLINE',
        total: integer(body.total, 'Tổng tiền'), address: text(body.address, 'Địa chỉ giao', 500),
        note: String(body.note ?? '').slice(0, 500), lines, createdAt: now, updatedAt: now,
      }
      if (body.customerToken) order.customerToken = text(body.customerToken, 'FCM token', 4096)
      if (body.paymentReference) order.paymentReference = text(body.paymentReference, 'Mã thanh toán', 500)
      if (body.deliveryCoordinates) {
        order.deliveryCoordinates = coordinates(body.deliveryCoordinates.latitude, body.deliveryCoordinates.longitude)
      }
      state.orders.unshift(order)
      save()
      return order
    }
    if (resource === 'menu' && method === 'GET') {
      return { shop: { ...state.shop, status: shopStatus(state.shop, now) }, groups: state.groups, items: state.items }
    }
    reject('Không tìm thấy tích hợp', 404)
  }

  if (area !== 'owner') reject('Không tìm thấy đường dẫn', 404)
  if (!(sessions.get(bearer(req)) > now)) reject('Vui lòng đăng nhập lại', 401)

  if (resource === 'dashboard' && method === 'GET') {
    return {
      shop: { ...state.shop, status: shopStatus(state.shop, now) },
      groups: state.groups, items: state.items, demo,
      orders: state.orders.map(order => ({
        ...ownerOrderView(order), late: deliveryStatuses.includes(order.status) && order.status !== 'DELIVERED'
          && now - order.createdAt >= 45 * 60_000,
      })),
    }
  }
  if (resource === 'orders' && method === 'POST' && id && action) {
    const body = await json(req)
    return ownerOrderView(await ownerOrderAction(orderById(id), action, body))
  }
  if (resource === 'shop' && method === 'POST') {
    const body = await json(req)
    if (id === 'profile') {
      const name = text(body.name, 'Tên quán')
      const phone = text(body.phone, 'Số điện thoại', 32)
      const address = text(body.address, 'Địa chỉ', 500)
      Object.assign(state.shop, { name, phone, address }, coordinates(body.latitude, body.longitude))
    } else if (id === 'mode') {
      if (!['OPEN', 'CLOSED', 'BUSY', 'SCHEDULE'].includes(body.mode)) reject('Trạng thái quán không hợp lệ')
      if (body.mode === 'BUSY' && ![15, 30, 60, 1440].includes(body.minutes)) reject('Thời lượng bận không hợp lệ')
      if (body.mode !== 'BUSY') state.shop.mode = body.mode
      state.shop.busyUntil = body.mode === 'BUSY' ? now + body.minutes * 60_000 : 0
    } else if (id === 'schedule') {
      if (body.date !== undefined) {
        const date = text(body.date, 'Ngày', 10)
        const parsed = new Date(date)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(+parsed) || parsed.toISOString().slice(0, 10) !== date) {
          reject('Ngày phải có định dạng YYYY-MM-DD')
        }
        if (body.reset === true) delete state.shop.overrides[date]
        else state.shop.overrides[date] = scheduleEntry(body.hours)
      } else {
        state.shop.week[integer(body.day, 'Ngày trong tuần', 0, 6)] = scheduleEntry(body.hours)
      }
    } else reject('Không tìm thấy thao tác', 404)
    save()
    return state.shop
  }
  if (resource === 'groups' || resource === 'items') {
    const list = state[resource]
    if (method === 'DELETE' && id) {
      const row = matching(id, list)
      if (resource === 'groups' && state.items.some(item => item.groupId === id)) reject('Nhóm vẫn còn món', 409)
      list.splice(list.indexOf(row), 1)
      save()
      return { ok: true }
    }
    if (method === 'POST') {
      const body = await json(req)
      const row = { id: id ? matching(id, list).id : randomUUID(), name: text(body.name, 'Tên') }
      if (resource === 'items') {
        row.groupId = matching(body.groupId, state.groups).id
        row.price = integer(body.price, 'Giá món')
        row.sizes = options(body.sizes, 'Kích cỡ', 1)
        row.toppings = options(body.toppings, 'Món thêm', 0, true)
        row.available = body.available === true
      }
      if (id) Object.assign(matching(id, list), row)
      else list.push(row)
      save()
      return row
    }
  }
  reject('Không tìm thấy đường dẫn', 404)
}

// Retry failed deliveries without blocking owner requests. The receiver can deduplicate by event ID.
let processingEvents = false
async function deliverEvents() {
  if (processingEvents) return
  processingEvents = true
  try {
    for (const entry of [...state.events]) {
      if (entry.sentAt || entry.retryAt > Date.now()) continue
      const order = orderById(entry.orderId)
      if (entry.type === 'REFUND_REQUESTED' && order.refundStatus !== 'REQUESTED') continue
      const deliver = entry.type === 'ORDER_STATUS' ? integrations.notify
        : entry.type === 'REFUND_REQUESTED' ? integrations.refund : null
      if (!deliver) continue
      try {
        if (await deliver(entry, order)) entry.sentAt = Date.now()
        else continue
      } catch {
        entry.retryAt = Date.now() + 30000
      }
      save()
    }
  } finally {
    processingEvents = false
  }
}
if (integrations.notify || integrations.refund) {
  setInterval(() => deliverEvents().catch(error => console.error(error.message)), 2000).unref()
}

setInterval(() => {
  if (state.shop.busyUntil > 0 && state.shop.busyUntil <= Date.now()) {
    const expired = state.shop.busyUntil
    state.shop.busyUntil = 0
    try {
      save()
    } catch (error) {
      state.shop.busyUntil = expired
      console.error(error.message)
    }
  }
}, 15000).unref()

const app = express()
app.disable('x-powered-by')
app.use(async (req, res) => {
  res.set('Cache-Control', 'no-store')
  try {
    res.json(await route(req))
  } catch (error) {
    if (!error.status) console.error(error)
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Lỗi máy chủ' })
  }
})
const server = app.listen(Number(process.env.PORT || 8787), process.env.OWNER_HOST || '127.0.0.1', () => {
  console.log('Owner API listening on', server.address().port)
})
