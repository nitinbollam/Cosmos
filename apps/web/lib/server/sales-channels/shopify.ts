import { createHmac, timingSafeEqual } from 'node:crypto'
import type { SalesChannelConnection } from '@/generated/prisma-sales-channels'
import type { SKU } from '@/generated/prisma-inventory'
import { salesChannelsDb } from '../db'
import { decryptSecret } from '../crypto-util'
import { jwtSecret } from '../env'
import { ApiError } from '../session'
import * as core from './core'
import type { ExternalOrderDto } from './core'

const SHOPIFY_API_VERSION = '2024-10'

type ShopifyCredentials = {
  accessToken: string
  locationId: string
}

function shopifyClientId(): string {
  const id = process.env.SHOPIFY_CLIENT_ID?.trim()
  if (!id) throw new ApiError(503, 'Shopify is not configured (SHOPIFY_CLIENT_ID missing)')
  return id
}

function shopifyClientSecret(): string {
  const secret = process.env.SHOPIFY_CLIENT_SECRET?.trim()
  if (!secret) throw new ApiError(503, 'Shopify is not configured (SHOPIFY_CLIENT_SECRET missing)')
  return secret
}

function normalizeShopDomain(shop: string): string {
  const trimmed = shop.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '')
  if (!trimmed.endsWith('.myshopify.com')) {
    throw new ApiError(400, 'Shop domain must be a *.myshopify.com hostname')
  }
  return trimmed
}

function appBaseUrl(): string {
  return (
    process.env.APP_URL?.trim() ||
    process.env.PLEROS_CLIENT_ORIGIN?.trim() ||
    process.env.NEXT_PUBLIC_WEB_ADMIN_ORIGIN?.trim() ||
    'http://localhost:4000'
  ).replace(/\/$/, '')
}

function oauthRedirectUri(): string {
  return `${appBaseUrl()}/api/v1/sales-channels/shopify/callback`
}

function signOAuthState(payload: { tenantId: string; shop: string; ts: number }): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = createHmac('sha256', jwtSecret()).update(data).digest('base64url')
  return `${data}.${sig}`
}

function verifyOAuthState(state: string): { tenantId: string; shop: string } {
  const [data, sig] = state.split('.')
  if (!data || !sig) throw new ApiError(400, 'Invalid OAuth state')
  const expected = createHmac('sha256', jwtSecret()).update(data).digest('base64url')
  const sigBuf = Buffer.from(sig)
  const expectedBuf = Buffer.from(expected)
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    throw new ApiError(400, 'Invalid OAuth state')
  }
  const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as {
    tenantId: string
    shop: string
    ts: number
  }
  if (Date.now() - payload.ts > 15 * 60 * 1000) throw new ApiError(400, 'OAuth state expired')
  return { tenantId: payload.tenantId, shop: normalizeShopDomain(payload.shop) }
}

function parseCredentials(connection: SalesChannelConnection): ShopifyCredentials {
  try {
    return JSON.parse(decryptSecret(connection.credentials)) as ShopifyCredentials
  } catch {
    throw new ApiError(500, 'Invalid Shopify credentials on connection')
  }
}

async function shopifyGraphql<T>(
  shopDomain: string,
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query, variables }),
  })
  const json = (await res.json()) as {
    data?: T
    errors?: Array<{ message: string }>
  }
  if (!res.ok || json.errors?.length) {
    const message = json.errors?.map((e) => e.message).join('; ') || `Shopify API error (${res.status})`
    throw new ApiError(502, message)
  }
  if (!json.data) throw new ApiError(502, 'Empty Shopify GraphQL response')
  return json.data
}

export function getShopifyAuthorizeUrl(shopDomain: string, tenantId: string): string {
  const shop = normalizeShopDomain(shopDomain)
  const state = signOAuthState({ tenantId, shop, ts: Date.now() })
  const scopes = [
    'read_products',
    'write_products',
    'read_inventory',
    'write_inventory',
    'read_orders',
    'write_fulfillments',
  ].join(',')
  const params = new URLSearchParams({
    client_id: shopifyClientId(),
    scope: scopes,
    redirect_uri: oauthRedirectUri(),
    state,
  })
  return `https://${shop}/admin/oauth/authorize?${params.toString()}`
}

async function fetchPrimaryLocationId(shopDomain: string, accessToken: string): Promise<string> {
  const data = await shopifyGraphql<{
    locations: { edges: Array<{ node: { id: string; isActive: boolean; isPrimary?: boolean } }> }
  }>(
    shopDomain,
    accessToken,
    `{ locations(first: 10) { edges { node { id isActive isPrimary } } } }`,
  )
  const locations = data.locations.edges.map((e) => e.node).filter((l) => l.isActive)
  const primary = locations.find((l) => l.isPrimary) ?? locations[0]
  if (!primary) throw new ApiError(502, 'Shopify shop has no active inventory location')
  return primary.id
}

export async function handleShopifyOAuthCallback(query: {
  shop: string
  code: string
  state: string
}): Promise<SalesChannelConnection> {
  const shop = normalizeShopDomain(query.shop)
  const { tenantId, shop: stateShop } = verifyOAuthState(query.state)
  if (shop !== stateShop) {
    throw new ApiError(400, 'Shop domain mismatch in OAuth callback')
  }

  const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: shopifyClientId(),
      client_secret: shopifyClientSecret(),
      code: query.code,
    }),
  })
  const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string }
  if (!tokenRes.ok || !tokenJson.access_token) {
    throw new ApiError(502, tokenJson.error ?? 'Failed to exchange Shopify OAuth code')
  }

  const locationId = await fetchPrimaryLocationId(shop, tokenJson.access_token)
  const connection = await core.connectChannel(
    tenantId,
    'SHOPIFY',
    { accessToken: tokenJson.access_token, locationId },
    { shopDomain: shop },
  )
  await core.queueAllEligibleSkus(tenantId, connection.id)
  return connection
}

function parseImageUrls(raw: SKU['imageUrls']): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
  }
  return []
}

function moneyAmount(price: SKU['price']): string {
  return Number(price).toFixed(2)
}

export async function pushSkuToShopify(
  connection: SalesChannelConnection,
  sku: SKU,
  stockLevel: number,
): Promise<{ externalListingId: string }> {
  if (!connection.shopDomain) throw new ApiError(400, 'Shopify connection missing shop domain')
  const creds = parseCredentials(connection)
  const images = parseImageUrls(sku.imageUrls).map((src) => ({ src }))
  const listing = await salesChannelsDb.salesChannelListing.findFirst({
    where: { connectionId: connection.id, skuId: sku.id },
  })

  if (listing?.externalListingId) {
    const productId = listing.externalListingId
    const updateData = await shopifyGraphql<{
      productUpdate: {
        product: { id: string; variants: { edges: Array<{ node: { id: string; inventoryItem: { id: string } } }> } }
        userErrors: Array<{ message: string }>
      }
    }>(
      connection.shopDomain,
      creds.accessToken,
      `mutation productUpdate($input: ProductInput!) {
        productUpdate(input: $input) {
          product {
            id
            variants(first: 1) { edges { node { id inventoryItem { id } } } }
          }
          userErrors { message }
        }
      }`,
      {
        input: {
          id: productId,
          title: sku.name,
          descriptionHtml: sku.description ?? '',
          variants: [{ price: moneyAmount(sku.price) }],
          ...(images.length > 0 ? { images } : {}),
        },
      },
    )
    const errors = updateData.productUpdate.userErrors
    if (errors.length > 0) throw new ApiError(502, errors.map((e) => e.message).join('; '))

    const variant = updateData.productUpdate.product.variants.edges[0]?.node
    if (variant?.inventoryItem?.id) {
      await setInventoryQuantity(
        connection.shopDomain,
        creds.accessToken,
        creds.locationId,
        variant.inventoryItem.id,
        stockLevel,
      )
    }
    return { externalListingId: productId }
  }

  const createData = await shopifyGraphql<{
    productCreate: {
      product: {
        id: string
        variants: { edges: Array<{ node: { id: string; inventoryItem: { id: string } } }> }
      }
      userErrors: Array<{ message: string }>
    }
  }>(
    connection.shopDomain,
    creds.accessToken,
    `mutation productCreate($input: ProductInput!) {
      productCreate(input: $input) {
        product {
          id
          variants(first: 1) { edges { node { id inventoryItem { id } } } }
        }
        userErrors { message }
      }
    }`,
    {
      input: {
        title: sku.name,
        descriptionHtml: sku.description ?? '',
        variants: [{ price: moneyAmount(sku.price), sku: sku.code }],
        ...(images.length > 0 ? { images } : {}),
      },
    },
  )
  const errors = createData.productCreate.userErrors
  if (errors.length > 0) throw new ApiError(502, errors.map((e) => e.message).join('; '))

  const product = createData.productCreate.product
  const variant = product.variants.edges[0]?.node
  if (variant?.inventoryItem?.id) {
    await setInventoryQuantity(
      connection.shopDomain,
      creds.accessToken,
      creds.locationId,
      variant.inventoryItem.id,
      stockLevel,
    )
  }
  return { externalListingId: product.id }
}

async function setInventoryQuantity(
  shopDomain: string,
  accessToken: string,
  locationId: string,
  inventoryItemId: string,
  quantity: number,
) {
  const data = await shopifyGraphql<{
    inventorySetQuantities: { userErrors: Array<{ message: string }> }
  }>(
    shopDomain,
    accessToken,
    `mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
      inventorySetQuantities(input: $input) {
        userErrors { message }
      }
    }`,
    {
      input: {
        name: 'available',
        reason: 'correction',
        ignoreCompareQuantity: true,
        quantities: [
          {
            inventoryItemId,
            locationId,
            quantity: Math.max(0, Math.floor(quantity)),
          },
        ],
      },
    },
  )
  const errors = data.inventorySetQuantities.userErrors
  if (errors.length > 0) throw new ApiError(502, errors.map((e) => e.message).join('; '))
}

type ShopifyOrderPayload = {
  id?: number | string
  admin_graphql_api_id?: string
  email?: string
  phone?: string
  note?: string
  line_items?: Array<{
    product_id?: number | string | null
    admin_graphql_api_id?: string
    title?: string
    quantity?: number
    price?: string
  }>
  customer?: { first_name?: string; last_name?: string; email?: string; phone?: string }
  shipping_address?: Record<string, unknown>
}

export function verifyShopifyWebhookHmac(rawBody: Buffer, hmacHeader: string): void {
  const secret = shopifyClientSecret()
  const digest = createHmac('sha256', secret).update(rawBody).digest('base64')
  const provided = Buffer.from(hmacHeader)
  const expected = Buffer.from(digest)
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new ApiError(401, 'Invalid Shopify webhook signature')
  }
}

function shopifyProductGid(productId: number | string): string {
  const raw = String(productId)
  if (raw.startsWith('gid://')) return raw
  return `gid://shopify/Product/${raw}`
}

function shopifyOrderGid(order: ShopifyOrderPayload): string {
  if (order.admin_graphql_api_id) return order.admin_graphql_api_id
  return `gid://shopify/Order/${order.id}`
}

export async function handleShopifyOrderWebhook(
  payload: unknown,
  hmacHeader: string,
  shopDomain: string,
  rawBody: Buffer,
): Promise<void> {
  verifyShopifyWebhookHmac(rawBody, hmacHeader)
  const order = payload as ShopifyOrderPayload
  const shop = normalizeShopDomain(shopDomain)

  const connection = await salesChannelsDb.salesChannelConnection.findFirst({
    where: { type: 'SHOPIFY', shopDomain: shop, isActive: true },
  })
  if (!connection) throw new ApiError(404, 'No active Shopify connection for shop')

  const customerName = order.customer
    ? `${order.customer.first_name ?? ''} ${order.customer.last_name ?? ''}`.trim()
    : ''
  const externalOrder: ExternalOrderDto = {
    externalOrderId: shopifyOrderGid(order),
    customer: {
      name: customerName || 'Shopify Customer',
      email: order.email ?? order.customer?.email,
      phone: order.phone ?? order.customer?.phone,
    },
    shippingAddress: order.shipping_address,
    notes: order.note ? `Shopify order ${order.id}: ${order.note}` : `Shopify order ${order.id}`,
    lineItems: (order.line_items ?? [])
      .filter((li) => li.product_id != null)
      .map((li) => ({
        externalListingId: shopifyProductGid(li.product_id!),
        quantity: Math.max(1, Math.floor(Number(li.quantity ?? 1))),
        unitPrice: Number(li.price ?? 0),
        title: li.title,
      })),
  }

  if (externalOrder.lineItems.length === 0) return
  await core.importChannelOrder(connection.tenantId, connection.id, externalOrder)
}

export async function pushFulfillmentToShopify(
  connection: SalesChannelConnection,
  externalOrderId: string,
  shipment: { carrier: string; trackingNumber: string },
): Promise<void> {
  if (!connection.shopDomain) throw new ApiError(400, 'Shopify connection missing shop domain')
  const creds = parseCredentials(connection)

  const orderData = await shopifyGraphql<{
    order: {
      fulfillmentOrders: {
        edges: Array<{ node: { id: string; status: string } }>
      }
    } | null
  }>(
    connection.shopDomain,
    creds.accessToken,
    `query orderFulfillmentOrders($id: ID!) {
      order(id: $id) {
        fulfillmentOrders(first: 10) {
          edges { node { id status } }
        }
      }
    }`,
    { id: externalOrderId },
  )

  const fulfillmentOrder = orderData.order?.fulfillmentOrders.edges.find(
    (e) => e.node.status === 'OPEN' || e.node.status === 'IN_PROGRESS',
  )?.node
  if (!fulfillmentOrder) throw new ApiError(404, 'No open Shopify fulfillment order')

  const result = await shopifyGraphql<{
    fulfillmentCreateV2: { userErrors: Array<{ message: string }> }
  }>(
    connection.shopDomain,
    creds.accessToken,
    `mutation fulfillmentCreateV2($fulfillment: FulfillmentV2Input!) {
      fulfillmentCreateV2(fulfillment: $fulfillment) {
        userErrors { message }
      }
    }`,
    {
      fulfillment: {
        lineItemsByFulfillmentOrder: [{ fulfillmentOrderId: fulfillmentOrder.id }],
        trackingInfo: {
          company: shipment.carrier,
          number: shipment.trackingNumber,
        },
        notifyCustomer: true,
      },
    },
  )
  const errors = result.fulfillmentCreateV2.userErrors
  if (errors.length > 0) throw new ApiError(502, errors.map((e) => e.message).join('; '))
}

export async function findConnectionByShopDomain(shopDomain: string) {
  return salesChannelsDb.salesChannelConnection.findFirst({
    where: { shopDomain: normalizeShopDomain(shopDomain), type: 'SHOPIFY', isActive: true },
  })
}
