export const deliveryStatuses = [
  'FINDING_DRIVER', 'DRIVER_ARRIVED', 'PICKED_UP', 'DELIVERING', 'DELIVERED',
]

export function reject(message, status = 400) {
  throw Object.assign(new Error(message), { status })
}

export function text(value, label, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    reject(label + ' không hợp lệ')
  }
  return value.trim()
}

export function integer(value, label, min = 0, max = 1_000_000_000) {
  if (!Number.isSafeInteger(value) || value < min || value > max) reject(label + ' không hợp lệ')
  return value
}

export function coordinates(latitude, longitude) {
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
      !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
    reject('Tọa độ không hợp lệ')
  }
  return { latitude, longitude }
}

export function scheduleEntry(entry) {
  if (entry === null) return null
  const time = /^([01]\d|2[0-3]):[0-5]\d$/
  if (!time.test(entry?.from) || !time.test(entry?.to) || entry.from >= entry.to) {
    reject('Giờ mở phải đứng trước giờ đóng, định dạng HH:mm')
  }
  return { from: entry.from, to: entry.to }
}

export function localTime(now) {
  // The shop operates on Vietnam time. ISO fields are used only for local calendar lookup.
  const local = new Date(now + 7 * 60 * 60 * 1000)
  return { day: local.getUTCDay(), date: local.toISOString().slice(0, 10), time: local.toISOString().slice(11, 16) }
}

export function shopStatus(shop, now) {
  if (shop.busyUntil > now) return 'BUSY'
  if (shop.mode === 'OPEN' || shop.mode === 'CLOSED') return shop.mode
  const { day, date, time } = localTime(now)
  const hours = Object.hasOwn(shop.overrides, date) ? shop.overrides[date] : shop.week[day]
  return hours && time >= hours.from && time < hours.to ? 'OPEN' : 'CLOSED'
}

export function advanceDelivery(order, status, driver, now) {
  const current = deliveryStatuses.indexOf(order.status)
  const next = deliveryStatuses.indexOf(status)
  const assigned = status === 'DRIVER_ASSIGNED' && current === 0 && driver
  if (status === 'DRIVER_ASSIGNED' && current > 0) return false
  if (current < 0 || (next < 0 && !assigned)) reject('Trạng thái giao hàng không hợp lệ')
  if (!assigned && next <= current) return false
  if (driver) {
    const details = {
      name: text(driver.name, 'Tên tài xế'),
      phone: text(driver.phone, 'Số tài xế'),
      plate: text(driver.plate, 'Biển số'),
    }
    if (assigned && JSON.stringify(order.driver) === JSON.stringify(details)) return false
    order.driver = details
  }
  if (!order.driver) reject('Chưa có thông tin tài xế')
  if (!assigned) order.status = status
  order.updatedAt = now
  return true
}
