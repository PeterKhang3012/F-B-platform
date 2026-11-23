export class MockShippingProvider {
  async dispatch({ orderId, pickupAddress, deliveryAddress, cod, note }) {
    if (!pickupAddress || !deliveryAddress || !Number.isSafeInteger(cod) || cod < 0) {
      throw new Error('Thông tin giao hàng không hợp lệ')
    }
    return {
      shipmentId: 'mock-' + orderId,
      driver: { name: 'Nguyễn Văn An (demo)', phone: '0900000000', plate: '59A1-000.00' },
      request: { pickupAddress, deliveryAddress, cod, note },
    }
  }
}

export class HttpShippingProvider {
  constructor(provider, url, token) {
    if (!['ahamove', 'lalamove'].includes(provider)) {
      throw new Error('SHIPPING_PROVIDER must be ahamove or lalamove')
    }
    this.provider = provider
    this.url = new URL(url)
    if (this.url.protocol !== 'https:' || !token) {
      throw new Error('The shipping adapter requires HTTPS and SHIPPING_ADAPTER_TOKEN')
    }
    this.token = token
  }

  async dispatch(request) {
    const response = await fetch(this.url, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + this.token,
        'Idempotency-Key': request.orderId,
      },
      body: JSON.stringify({ ...request, provider: this.provider }),
    })
    if (!response.ok) throw new Error('Shipping adapter returned HTTP ' + response.status)
    return response.json()
  }
}
