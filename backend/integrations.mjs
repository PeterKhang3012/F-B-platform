import { sign } from 'node:crypto'
import { readFileSync } from 'node:fs'

const scope = 'https://www.googleapis.com/auth/firebase.messaging'
const tokenUrl = 'https://oauth2.googleapis.com/token'
const deliveryMessages = {
  DRIVER_ASSIGNED: 'Đã có tài xế nhận đơn',
  DRIVER_ARRIVED: 'Tài xế đã đến quán',
  PICKED_UP: 'Tài xế đã lấy món',
  DELIVERING: 'Đơn hàng đang giao',
  DELIVERED: 'Đơn hàng đã giao thành công',
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

async function post(url, headers, body) {
  const response = await fetch(url, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers, body,
  })
  if (!response.ok) throw new Error('Integration returned HTTP ' + response.status)
  return response
}

export function integrationsFromEnvironment() {
  const accountFile = process.env.FCM_SERVICE_ACCOUNT_FILE
  const account = accountFile ? JSON.parse(readFileSync(accountFile, 'utf8')) : null
  if (account && (!account.client_email || !account.private_key || !account.project_id)) {
    throw new Error('Invalid Firebase service account file')
  }

  const refundUrl = process.env.REFUND_CALLBACK_URL ? new URL(process.env.REFUND_CALLBACK_URL) : null
  const refundToken = process.env.REFUND_CALLBACK_TOKEN
  if (refundUrl && (refundUrl.protocol !== 'https:' || !refundToken)) {
    throw new Error('Refund callback requires HTTPS and REFUND_CALLBACK_TOKEN')
  }

  let cachedToken
  let expiresAt = 0

  async function accessToken() {
    if (Date.now() + 60000 < expiresAt) return cachedToken
    const iat = Math.floor(Date.now() / 1000)
    const claims = [
      encode({ alg: 'RS256', typ: 'JWT' }),
      encode({ iss: account.client_email, scope, aud: tokenUrl, iat, exp: iat + 3600 }),
    ].join('.')
    const assertion = claims + '.' + sign('RSA-SHA256', Buffer.from(claims), account.private_key).toString('base64url')
    const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
    const response = await post(tokenUrl, { 'Content-Type': 'application/x-www-form-urlencoded' }, body)
    const result = await response.json()
    cachedToken = result.access_token
    expiresAt = Date.now() + result.expires_in * 1000
    return cachedToken
  }

  return {
    notify: account && (async (entry, order) => {
      if (!order.customerToken) return false
      const token = await accessToken()
      const url = 'https://fcm.googleapis.com/v1/projects/' + encodeURIComponent(account.project_id) + '/messages:send'
      await post(url, { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, JSON.stringify({
        message: {
          token: order.customerToken,
          notification: { title: 'Đơn hàng', body: entry.message || deliveryMessages[entry.status] || entry.status },
          data: { eventId: entry.id, orderId: order.id, status: entry.status },
          android: { priority: 'HIGH', notification: { channel_id: 'order_updates', default_vibrate_timings: true } },
        },
      }))
      return true
    }),
    refund: refundUrl && (async (entry, order) => {
      await post(refundUrl, {
        'Content-Type': 'application/json', Authorization: 'Bearer ' + refundToken, 'Idempotency-Key': entry.id,
      }, JSON.stringify({ orderId: order.id, eventId: entry.id, amount: entry.amount, paymentReference: order.paymentReference }))
      return true
    }),
  }
}
