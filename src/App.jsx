import { useEffect, useMemo, useState } from 'react'
import './App.css'

const STORAGE_KEY = 'magicorder:v1'

const todayKey = () => new Date().toISOString().slice(0, 10)
const money = (value) => `RM ${Number(value || 0).toFixed(2)}`
const numberValue = (value) => Math.max(0, Number(value) || 0)
const makeId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
const PRODUCT_TYPE_OPTIONS = ['Red', 'Blue', 'Black Menthol', 'Ice Blast']
const productDisplayName = (product) => `${product.brand || ''} ${product.flavour || ''}`.trim() || product.name

const sampleSuppliers = [
  {
    id: 'sup-golden',
    name: 'Golden Leaf Trading',
    phone: '03-2148 1020',
    notes: 'Main supplier for premium brands. Morning delivery.',
    brands: 'Marlboro, Dunhill, Mevius',
  },
  {
    id: 'sup-suria',
    name: 'Suria Tobacco Supply',
    phone: '012-782 4431',
    notes: 'Good fallback for menthol stock.',
    brands: 'Winston, L.A., Sampoerna',
  },
  {
    id: 'sup-borneo',
    name: 'Borneo Smoke Wholesale',
    phone: '088-412 900',
    notes: 'Weekly price confirmation required.',
    brands: 'Camel, Rothmans, Benson',
  },
]

const sampleProducts = [
  {
    id: 'prd-marlboro-red',
    name: 'Marlboro Red',
    brand: 'Marlboro',
    flavour: 'Red',
    keepStockQty: 120,
    defaultSupplierId: 'sup-golden',
    defaultBuyingPrice: 17.2,
    barcode: '9556570000012',
    active: true,
  },
  {
    id: 'prd-marlboro-gold',
    name: 'Marlboro Gold',
    brand: 'Marlboro',
    flavour: 'Gold',
    keepStockQty: 90,
    defaultSupplierId: 'sup-golden',
    defaultBuyingPrice: 17.2,
    barcode: '9556570000029',
    active: true,
  },
  {
    id: 'prd-dunhill-blue',
    name: 'Dunhill Blue',
    brand: 'Dunhill',
    flavour: 'Blue',
    keepStockQty: 100,
    defaultSupplierId: 'sup-golden',
    defaultBuyingPrice: 17.5,
    barcode: '',
    active: true,
  },
  {
    id: 'prd-winston-red',
    name: 'Winston Red',
    brand: 'Winston',
    flavour: 'Classic',
    keepStockQty: 80,
    defaultSupplierId: 'sup-suria',
    defaultBuyingPrice: 15.9,
    barcode: '',
    active: true,
  },
  {
    id: 'prd-la-menthol',
    name: 'L.A. Menthol',
    brand: 'L.A.',
    flavour: 'Menthol',
    keepStockQty: 70,
    defaultSupplierId: 'sup-suria',
    defaultBuyingPrice: 14.8,
    barcode: '',
    active: true,
  },
  {
    id: 'prd-camel-purple',
    name: 'Camel Purple',
    brand: 'Camel',
    flavour: 'Purple Mint',
    keepStockQty: 60,
    defaultSupplierId: 'sup-borneo',
    defaultBuyingPrice: 16.4,
    barcode: '',
    active: true,
  },
]

const createInitialState = () => ({
  products: sampleProducts,
  suppliers: sampleSuppliers,
  checks: {},
  stockChecks: [],
  orders: [],
  duitStock: sampleProducts.reduce((stock, product) => {
    stock[product.id] = { qty: 0, value: 0 }
    return stock
  }, {}),
})

const loadState = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? { ...createInitialState(), ...JSON.parse(raw) } : createInitialState()
  } catch {
    return createInitialState()
  }
}

function App() {
  const [data, setData] = useState(loadState)
  const [page, setPage] = useState('dashboard')
  const [settingsTab, setSettingsTab] = useState('orders')
  const [receivingOrderId, setReceivingOrderId] = useState(null)
  const [syncNotice, setSyncNotice] = useState('')
  const [editingProduct, setEditingProduct] = useState(null)
  const [editingSupplier, setEditingSupplier] = useState(null)
  const currentDay = todayKey()

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }, [data])

  useEffect(() => {
    if (!syncNotice) return undefined
    const timer = window.setTimeout(() => setSyncNotice(''), 4000)
    return () => window.clearTimeout(timer)
  }, [syncNotice])

  const todayDraft = useMemo(() => data.checks[currentDay] || {}, [currentDay, data.checks])
  const upcomingOrders = data.orders.filter((order) => order.status === 'upcoming')
  const receivedTodayOrders = data.orders.filter(
    (order) => order.status === 'closed' && order.receivedAt?.slice(0, 10) === currentDay,
  )

  const stats = useMemo(() => {
    const todayOrders = data.orders.filter((order) => order.createdAt.slice(0, 10) === currentDay)
    const checkedProducts = Object.values(todayDraft).filter((row) => row.confirmed).length
    const orderQty = todayOrders.reduce(
      (sum, order) => sum + order.items.reduce((itemSum, item) => itemSum + item.finalOrderQty, 0),
      0,
    )
    const orderValue = todayOrders.reduce(
      (sum, order) =>
        sum + order.items.reduce((itemSum, item) => itemSum + item.finalOrderQty * item.buyingPrice, 0),
      0,
    )
    const receivedValue = receivedTodayOrders.reduce(
      (sum, order) =>
        sum + order.items.reduce((itemSum, item) => itemSum + item.receivedQty * item.buyingPrice, 0),
      0,
    )

    return { checkedProducts, orderQty, orderValue, receivedValue }
  }, [currentDay, data.orders, receivedTodayOrders, todayDraft])

  const supplierById = useMemo(
    () => Object.fromEntries(data.suppliers.map((supplier) => [supplier.id, supplier])),
    [data.suppliers],
  )

  const productById = useMemo(
    () => Object.fromEntries(data.products.map((product) => [product.id, product])),
    [data.products],
  )

  const updateTodayRow = (product, patch) => {
    setData((current) => {
      const existing = current.checks[currentDay]?.[product.id] || {
        currentChecked: '',
        finalOrderQty: Math.max(0, product.keepStockQty),
        supplierId: product.defaultSupplierId,
        buyingPrice: product.defaultBuyingPrice,
      }

      const nextRow = { ...existing, ...patch }
      if (
        Object.prototype.hasOwnProperty.call(patch, 'currentChecked') &&
        !Object.prototype.hasOwnProperty.call(patch, 'finalOrderQty')
      ) {
        nextRow.finalOrderQty = Math.max(0, product.keepStockQty - numberValue(patch.currentChecked))
      }

      return {
        ...current,
        checks: {
          ...current.checks,
          [currentDay]: {
            ...(current.checks[currentDay] || {}),
            [product.id]: nextRow,
          },
        },
      }
    })
  }

  const createSupplierOrders = ({ stayOnPage = false } = {}) => {
    const grouped = data.products.reduce((groups, product) => {
      const row = todayDraft[product.id]
      const finalOrderQty = numberValue(row?.finalOrderQty)
      if (!row?.confirmed || finalOrderQty <= 0) return groups
      const supplierId = row.supplierId || product.defaultSupplierId
      groups[supplierId] ||= []
      groups[supplierId].push({
        productId: product.id,
        productName: productDisplayName(product),
        brand: product.brand,
        flavour: product.flavour,
        keepStockQty: product.keepStockQty,
        currentChecked: numberValue(row.currentChecked),
        finalOrderQty,
        buyingPrice: numberValue(row.buyingPrice || product.defaultBuyingPrice),
        receivedQty: 0,
      })
      return groups
    }, {})

    const orders = Object.entries(grouped).map(([supplierId, items]) => ({
      id: makeId('ord'),
      supplierId,
      supplierName: supplierById[supplierId]?.name || 'Unknown supplier',
      orderDate: currentDay,
      createdAt: new Date().toISOString(),
      status: 'upcoming',
      items,
    }))

    if (!orders.length) return []
    setData((current) => ({ ...current, orders: [...orders, ...current.orders] }))
    if (!stayOnPage) {
      setSettingsTab('orders')
      setPage('settings')
    }
    return orders
  }

  const confirmReceive = (orderId, receivedRows) => {
    setData((current) => {
      const nextStock = { ...current.duitStock }
      const nextOrders = current.orders.map((order) => {
        if (order.id !== orderId) return order
        const items = order.items.map((item) => {
          const receivedQty = numberValue(receivedRows[item.productId])
          const currentStock = nextStock[item.productId] || { qty: 0, value: 0 }
          nextStock[item.productId] = {
            qty: currentStock.qty + receivedQty,
            value: currentStock.value + receivedQty * item.buyingPrice,
          }
          return { ...item, receivedQty }
        })
        return { ...order, items, status: 'closed', receivedAt: new Date().toISOString() }
      })
      return { ...current, orders: nextOrders, duitStock: nextStock }
    })
    setSyncNotice('Synced to DuitStock')
    setReceivingOrderId(null)
    setSettingsTab('orders')
    setPage('settings')
  }

  const saveStockCheckRecords = (records) => {
    if (!records.length) return
    setData((current) => {
      const checkedAt = new Date().toISOString()
      const nextStock = { ...current.duitStock }
      const nextProducts = current.products.map((product) => {
        const record = records.find((item) => item.productId === product.id)
        if (!record) return product
        const previousStock = nextStock[product.id] || { qty: 0, value: 0 }
        nextStock[product.id] = { ...previousStock, qty: record.totalQty }
        return { ...product, currentStock: record.totalQty }
      })
      const stockChecks = [
        ...records.map((record) => ({
          ...record,
          id: makeId('stk'),
          checkedAt,
        })),
        ...(current.stockChecks || []),
      ]
      return { ...current, products: nextProducts, duitStock: nextStock, stockChecks }
    })
  }

  const saveProduct = (form) => {
    setData((current) => {
      const isEditing = Boolean(form.id)
      const productId = form.id || makeId('prd')
      const brand = form.brand.trim()
      const type = form.flavour.trim()
      const currentStock = numberValue(form.currentStock)
      const product = {
        ...form,
        id: productId,
        name: `${brand} ${type}`.trim(),
        brand,
        flavour: type,
        keepStockQty: numberValue(form.keepStockQty),
        defaultBuyingPrice: numberValue(form.costPrice ?? form.defaultBuyingPrice),
        defaultSupplierId: form.defaultSupplierId || current.suppliers[0]?.id || '',
        barcode: form.barcode || '',
        active: true,
      }
      const products = isEditing
        ? current.products.map((item) => (item.id === product.id ? product : item))
        : [product, ...current.products]
      const previousStock = current.duitStock[productId] || { qty: 0, value: 0 }
      return {
        ...current,
        products,
        duitStock: {
          ...current.duitStock,
          [productId]: { ...previousStock, qty: currentStock },
        },
      }
    })
    setEditingProduct(null)
  }

  const deleteProduct = (productId) => {
    setData((current) => ({
      ...current,
      products: current.products.filter((product) => product.id !== productId),
    }))
  }

  const saveSupplier = (form) => {
    setData((current) => {
      const supplier = { ...form }
      const suppliers = supplier.id
        ? current.suppliers.map((item) => (item.id === supplier.id ? supplier : item))
        : [{ ...supplier, id: makeId('sup') }, ...current.suppliers]
      return { ...current, suppliers }
    })
    setEditingSupplier(null)
  }

  const deleteSupplier = (supplierId) => {
    setData((current) => ({
      ...current,
      suppliers: current.suppliers.filter((supplier) => supplier.id !== supplierId),
    }))
  }

  const openReceive = (orderId) => {
    setReceivingOrderId(orderId)
    setPage('receive')
  }

  return (
    <div className="min-h-screen bg-[#100d0b] text-stone-100">
      <div className="app-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">Internal replenishment</p>
            <h1>MagicOrder</h1>
          </div>
          <div className="date-pill">{currentDay}</div>
        </header>

        <nav className="tabs" aria-label="Main navigation">
          {[
            ['dashboard', 'Dashboard'],
            ['stock', 'Stock Check'],
            ['check', 'Purchase Order'],
            ['settings', 'Settings'],
          ].map(([id, label]) => (
            <button key={id} className={page === id ? 'active' : ''} onClick={() => setPage(id)}>
              {label}
            </button>
          ))}
        </nav>

        <main>
          {page === 'dashboard' && (
            <Dashboard
              stats={stats}
              orders={data.orders}
              duitStock={data.duitStock}
              products={data.products}
              onGoCheck={() => setPage('check')}
            />
          )}

          {page === 'stock' && (
            <StockCheckPage
              products={data.products}
              duitStock={data.duitStock}
              onSaveStockChecks={saveStockCheckRecords}
            />
          )}

          {page === 'check' && (
            <PurchaseOrderPage
              products={data.products}
              suppliers={data.suppliers}
              duitStock={data.duitStock}
              draft={todayDraft}
              onRowChange={updateTodayRow}
              onCreateOrders={createSupplierOrders}
            />
          )}

          {page === 'receive' && (
            <ReceiveOrder
              order={data.orders.find((order) => order.id === receivingOrderId)}
              onConfirm={confirmReceive}
              onBack={() => {
                setSettingsTab('orders')
                setPage('settings')
              }}
            />
          )}

          {page === 'settings' && (
            <SettingsPage
              activeTab={settingsTab}
              onTabChange={setSettingsTab}
              orders={upcomingOrders}
              productById={productById}
              onReceive={openReceive}
              syncNotice={syncNotice}
              products={data.products}
              suppliers={data.suppliers}
              duitStock={data.duitStock}
              editingProduct={editingProduct}
              onEditProduct={setEditingProduct}
              onSaveProduct={saveProduct}
              onDeleteProduct={deleteProduct}
              editingSupplier={editingSupplier}
              onEditSupplier={setEditingSupplier}
              onSaveSupplier={saveSupplier}
              onDeleteSupplier={deleteSupplier}
            />
          )}
        </main>
      </div>
    </div>
  )
}

function Dashboard({ stats, orders, duitStock, products, onGoCheck }) {
  const dashboard = useMemo(() => {
    const activeProducts = products.filter((product) => product.active)
    const rows = activeProducts.map((product) => {
      const currentQty = numberValue(duitStock[product.id]?.qty)
      const costPrice = numberValue(product.defaultBuyingPrice)
      return {
        product,
        name: productDisplayName(product),
        currentQty,
        defaultStock: numberValue(product.keepStockQty),
        costPrice,
        stockValue: currentQty * costPrice,
      }
    })

    const movementByProduct = new Map(
      activeProducts.map((product) => [product.id, { product, name: productDisplayName(product), qty: 0, value: 0 }]),
    )

    orders.forEach((order) => {
      order.items.forEach((item) => {
        const existing = movementByProduct.get(item.productId)
        if (!existing) return
        const qty = order.status === 'closed' ? numberValue(item.receivedQty) : numberValue(item.finalOrderQty)
        existing.qty += qty
        existing.value += qty * numberValue(item.buyingPrice)
      })
    })

    const movementRows = Array.from(movementByProduct.values())
    const hasMovement = movementRows.some((row) => row.qty > 0)

    return {
      totalStockCost: rows.reduce((sum, row) => sum + row.stockValue, 0),
      totalStockQty: rows.reduce((sum, row) => sum + row.currentQty, 0),
      highValue: [...rows].sort((a, b) => b.stockValue - a.stockValue).slice(0, 5),
      lowStock: [...rows].sort((a, b) => a.currentQty - b.currentQty).slice(0, 5),
      fastMoving: movementRows
        .filter((row) => row.qty > 0)
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 5),
      slowMoving: hasMovement
        ? movementRows.sort((a, b) => a.qty - b.qty).slice(0, 5)
        : [],
      hasMovement,
    }
  }, [duitStock, orders, products])

  return (
    <section className="page-stack">
      <div className="hero-band">
        <div>
          <p className="eyebrow">Packets only</p>
          <h2>Supplier orders from physical stock checks.</h2>
        </div>
        <button className="glow-button" onClick={onGoCheck}>Start check</button>
      </div>

      <div className="summary-grid">
        <SummaryCard label="Total cost of stock" value={money(dashboard.totalStockCost)} />
        <SummaryCard label="Total qty of cigarette" value={dashboard.totalStockQty} suffix="pkt" />
        <SummaryCard label="Today's total order qty" value={stats.orderQty} suffix="pkt" />
        <SummaryCard label="Today's total order amount" value={money(stats.orderValue)} />
      </div>

      <DashboardSection title="High stock value products">
        {dashboard.highValue.map((row) => (
          <DashboardRow
            key={row.product.id}
            title={row.name}
            left={`${row.currentQty} pkt current`}
            right={money(row.stockValue)}
          />
        ))}
      </DashboardSection>

      <DashboardSection title="Low stock products">
        {dashboard.lowStock.map((row) => (
          <DashboardRow
            key={row.product.id}
            title={row.name}
            left={`${row.currentQty} pkt current / ${row.defaultStock} pkt default`}
            right={`${Math.max(0, row.defaultStock - row.currentQty)} pkt shortage`}
          />
        ))}
      </DashboardSection>

      <DashboardSection title="Fast moving products">
        {dashboard.fastMoving.length ? (
          dashboard.fastMoving.map((row) => (
            <DashboardRow
              key={row.product.id}
              title={row.name}
              left={`${row.qty} pkt moved`}
              right={money(row.value)}
            />
          ))
        ) : (
          <EmptyState text="No movement yet." />
        )}
      </DashboardSection>

      <DashboardSection title="Slow moving products">
        {dashboard.hasMovement ? (
          dashboard.slowMoving.map((row) => (
            <DashboardRow
              key={row.product.id}
              title={row.name}
              left={`${row.qty} pkt moved`}
              right={money(row.value)}
            />
          ))
        ) : (
          <EmptyState text="No movement yet." />
        )}
      </DashboardSection>

      <DashboardSection title="Today's order summary">
        <div className="today-summary">
          <div>
            <strong>{stats.orderQty}<span> pkt</span></strong>
            <p>Today's total cigarette order qty</p>
          </div>
          <div>
            <strong>{money(stats.orderValue)}</strong>
            <p>Today's total cigarette order amount</p>
          </div>
        </div>
      </DashboardSection>
    </section>
  )
}

function SummaryCard({ label, value, suffix }) {
  return (
    <article className="summary-card">
      <strong>{value}{suffix ? <span> {suffix}</span> : null}</strong>
      <p>{label}</p>
    </article>
  )
}

function DashboardSection({ title, children }) {
  return (
    <section className="dashboard-panel">
      <div className="section-head compact-head">
        <h2>{title}</h2>
      </div>
      <div className="dashboard-list">{children}</div>
    </section>
  )
}

function DashboardRow({ title, left, right }) {
  return (
    <article className="dashboard-row">
      <strong>{title}</strong>
      <span>{left}</span>
      <b>{right}</b>
    </article>
  )
}

function StockCheckPage({ products, duitStock, onSaveStockChecks }) {
  const [selectedBrand, setSelectedBrand] = useState('')
  const [areaRows, setAreaRows] = useState({})
  const [checkedProducts, setCheckedProducts] = useState({})
  const [successMessage, setSuccessMessage] = useState('')

  const brands = useMemo(
    () =>
      Array.from(
        new Set(products.map((product) => product.brand?.trim()).filter(Boolean)),
      ).sort((a, b) => a.localeCompare(b)),
    [products],
  )

  const brandProducts = useMemo(
    () =>
      products
        .filter((product) => product.brand?.trim() === selectedBrand)
        .sort((a, b) => productDisplayName(a).localeCompare(productDisplayName(b))),
    [products, selectedBrand],
  )

  const updateArea = (productId, field, value) => {
    setAreaRows((current) => ({
      ...current,
      [productId]: { ...(current[productId] || {}), [field]: value },
    }))
    setSuccessMessage('')
  }

  const getAreaRow = (productId) => areaRows[productId] || {}
  const getAreaTotal = (productId) => {
    const row = getAreaRow(productId)
    return numberValue(row.displayQty) + numberValue(row.rackQty) + numberValue(row.storeQty)
  }
  const hasEnteredRow = (productId) => {
    const row = getAreaRow(productId)
    return ['displayQty', 'rackQty', 'storeQty'].some((field) => row[field] !== undefined && row[field] !== '')
  }

  const buildRecord = (product) => {
    const row = getAreaRow(product.id)
    return {
      productId: product.id,
      brand: product.brand,
      type: product.flavour,
      displayQty: numberValue(row.displayQty),
      rackQty: numberValue(row.rackQty),
      storeQty: numberValue(row.storeQty),
      totalQty: getAreaTotal(product.id),
      defaultStock: numberValue(product.keepStockQty),
    }
  }

  const confirmProduct = (product) => {
    const record = buildRecord(product)
    onSaveStockChecks([record])
    setCheckedProducts((current) => ({ ...current, [product.id]: true }))
    setSuccessMessage(`${productDisplayName(product)} checked`)
  }

  const enteredProducts = products.filter((product) => hasEnteredRow(product.id))
  const summaryQty = enteredProducts.reduce((sum, product) => sum + getAreaTotal(product.id), 0)

  const saveAllChecked = () => {
    const records = enteredProducts.map(buildRecord)
    if (!records.length) return
    onSaveStockChecks(records)
    setCheckedProducts((current) => ({
      ...current,
      ...Object.fromEntries(records.map((record) => [record.productId, true])),
    }))
    setSuccessMessage('Stock check saved')
  }

  return (
    <section className="page-stack with-sticky">
      <div className="section-head">
        <div>
          <p className="eyebrow">Stock Check</p>
          <h2>Count cigarettes by area</h2>
        </div>
      </div>

      {successMessage ? <div className="success-badge">✓ {successMessage}</div> : null}

      <div className="stock-check-panel">
        <label className="search-field brand-chooser">
          <span>Brand</span>
          <select value={selectedBrand} onChange={(event) => setSelectedBrand(event.target.value)}>
            <option value="">Choose brand</option>
            {brands.map((brand) => (
              <option key={brand} value={brand}>{brand}</option>
            ))}
          </select>
        </label>
      </div>

      {selectedBrand ? (
        <section className="brand-section stock-brand-section">
          <div className="brand-section-head">
            <h3>{selectedBrand}</h3>
          </div>
          <div className="stock-check-list">
            {brandProducts.map((product) => {
              const row = getAreaRow(product.id)
              const totalQty = getAreaTotal(product.id)
              const currentQty = numberValue(duitStock[product.id]?.qty ?? product.currentStock)
              return (
                <article className="stock-check-row" key={product.id}>
                  <div className="stock-check-topline">
                    <div className="product-title">
                      <strong>{productDisplayName(product)}</strong>
                      {checkedProducts[product.id] ? <span className="confirmed-badge">Checked</span> : null}
                    </div>
                    <strong className="stock-check-total">Total: {totalQty} pkt</strong>
                    <button className="glow-button compact" onClick={() => confirmProduct(product)}>
                      SC
                    </button>
                  </div>
                  <div className="stock-check-meta">
                    Default: {product.keepStockQty} | Current: {currentQty}
                  </div>
                  <div className="stock-area-inputs">
                    <label>
                      <span>Display</span>
                      <input
                        type="number"
                        min="0"
                        inputMode="numeric"
                        value={row.displayQty ?? ''}
                        onChange={(event) => updateArea(product.id, 'displayQty', event.target.value)}
                      />
                    </label>
                    <label>
                      <span>Rack</span>
                      <input
                        type="number"
                        min="0"
                        inputMode="numeric"
                        value={row.rackQty ?? ''}
                        onChange={(event) => updateArea(product.id, 'rackQty', event.target.value)}
                      />
                    </label>
                    <label>
                      <span>Store</span>
                      <input
                        type="number"
                        min="0"
                        inputMode="numeric"
                        value={row.storeQty ?? ''}
                        onChange={(event) => updateArea(product.id, 'storeQty', event.target.value)}
                      />
                    </label>
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      ) : (
        <EmptyState text="Choose a brand to start counting." />
      )}

      <div className="sticky-action">
        <div>
          <span>{enteredProducts.length} checked products</span>
          <strong>{summaryQty} pkt counted</strong>
        </div>
        <button className="glow-button" onClick={saveAllChecked}>Save All Checked</button>
      </div>
    </section>
  )
}

function PurchaseOrderPage({ products, suppliers, duitStock, draft, onRowChange, onCreateOrders }) {
  const [selectedSupplierId, setSelectedSupplierId] = useState('')
  const [selectedBrand, setSelectedBrand] = useState('')
  const [orderInputs, setOrderInputs] = useState({})
  const [autoFillHighlights, setAutoFillHighlights] = useState({})
  const [previewOrder, setPreviewOrder] = useState(null)

  const confirmedProducts = products.filter((product) => draft[product.id]?.confirmed)
  const supplierProducts = useMemo(
    () => products.filter((product) => !selectedSupplierId || product.defaultSupplierId === selectedSupplierId),
    [products, selectedSupplierId],
  )
  const supplierBrands = useMemo(
    () =>
      Array.from(
        new Set(supplierProducts.map((product) => product.brand?.trim()).filter(Boolean)),
      ).sort((a, b) => a.localeCompare(b)),
    [supplierProducts],
  )
  const brandProducts = useMemo(
    () =>
      supplierProducts
        .filter((product) => product.brand?.trim() === selectedBrand)
        .sort((a, b) => productDisplayName(a).localeCompare(productDisplayName(b))),
    [supplierProducts, selectedBrand],
  )

  const totals = confirmedProducts.reduce(
    (sum, product) => {
      const row = draft[product.id]
      const finalQty = numberValue(row.finalOrderQty)
      sum.qty += finalQty
      sum.value += finalQty * numberValue(row?.buyingPrice || product.defaultBuyingPrice)
      return sum
    },
    { qty: 0, value: 0 },
  )

  const getCurrentStock = (product) => numberValue(duitStock[product.id]?.qty ?? product.currentStock)
  const getNeededQty = (product) => Math.max(0, product.keepStockQty - getCurrentStock(product))
  const getRoundedOrderQty = (product) => {
    const neededQty = getNeededQty(product)
    return neededQty > 0 ? Math.ceil(neededQty / 10) * 10 : 0
  }
  const getOrderInput = (product) => {
    if (Object.prototype.hasOwnProperty.call(orderInputs, product.id)) return orderInputs[product.id]
    if (draft[product.id]?.confirmed) return draft[product.id].finalOrderQty
    return getRoundedOrderQty(product)
  }

  const triggerAutoFillHighlight = (brand) => {
    const highlighted = Object.fromEntries(
      supplierProducts
        .filter((product) => product.brand?.trim() === brand)
        .filter((product) => !draft[product.id]?.confirmed && getNeededQty(product) > 0)
        .map((product) => [product.id, true]),
    )
    setAutoFillHighlights(highlighted)
    window.setTimeout(() => setAutoFillHighlights({}), 1000)
  }

  const confirmProduct = (product) => {
    if (draft[product.id]?.confirmed) return
    const currentStock = getCurrentStock(product)
    const neededQty = getNeededQty(product)
    const finalOrderQty = numberValue(getOrderInput(product))
    if (finalOrderQty <= 0) return
    onRowChange(product, {
      currentChecked: currentStock,
      finalOrderQty,
      supplierId: selectedSupplierId,
      buyingPrice: draft[product.id]?.buyingPrice ?? product.defaultBuyingPrice,
      neededQty,
      confirmed: true,
    })
  }

  const confirmSelectedOrders = () => {
    brandProducts.forEach((product) => confirmProduct(product))
  }

  const removeProduct = (product) => {
    onRowChange(product, {
      currentChecked: '',
      finalOrderQty: 0,
      neededQty: 0,
      confirmed: false,
    })
  }

  const createPurchaseOrders = () => {
    const createdOrders = onCreateOrders({ stayOnPage: true })
    const selectedSupplierOrder = createdOrders.find((order) => order.supplierId === selectedSupplierId)
    if (selectedSupplierOrder) setPreviewOrder(selectedSupplierOrder)
  }

  return (
    <section className="page-stack with-sticky">
      <div className="section-head">
        <div>
          <p className="eyebrow">Purchase Order</p>
          <h2>Supplier ordering</h2>
        </div>
      </div>

      <div className="entry-panel">
        <label className="search-field brand-chooser">
          <span>Supplier</span>
          <select
            value={selectedSupplierId}
            onChange={(event) => {
              setSelectedSupplierId(event.target.value)
              setSelectedBrand('')
              setAutoFillHighlights({})
            }}
          >
            <option value="">Choose supplier</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
            ))}
          </select>
        </label>

        {selectedSupplierId ? (
          <label className="search-field brand-chooser">
            <span>Brand</span>
            <select
              value={selectedBrand}
              onChange={(event) => {
                setSelectedBrand(event.target.value)
                triggerAutoFillHighlight(event.target.value)
              }}
            >
              <option value="">Choose brand</option>
              {supplierBrands.map((brand) => (
                <option key={brand} value={brand}>{brand}</option>
              ))}
            </select>
          </label>
        ) : null}

        {selectedSupplierId && selectedBrand ? (
          <section className="brand-section">
            <div className="brand-section-head">
              <h3>{selectedBrand}</h3>
            </div>
            <div className="brand-results">
              {brandProducts.length === 0 ? <EmptyState text="No products for this supplier and brand." /> : null}
              {brandProducts.map((product) => {
                const currentStock = getCurrentStock(product)
                const neededQty = getNeededQty(product)
                const confirmed = Boolean(draft[product.id]?.confirmed)
                return (
                  <article className={`brand-product-row ${confirmed ? 'is-confirmed' : ''}`} key={product.id}>
                    <div className="product-title">
                      <strong>{productDisplayName(product)}</strong>
                      <span>
                        Current: {currentStock} pkt <em>|</em> Default: {product.keepStockQty} pkt <em>|</em> Required: {neededQty} pkt
                      </span>
                      {confirmed ? <span className="confirmed-badge">Confirmed</span> : null}
                    </div>
                    <div className="po-cost">
                      <span>Cost price</span>
                      <strong>{money(product.defaultBuyingPrice)}</strong>
                    </div>
                    <label className={autoFillHighlights[product.id] ? 'order-autofilled' : ''}>
                      <span>Order qty</span>
                      <input
                        type="number"
                        min="0"
                        inputMode="numeric"
                        value={getOrderInput(product)}
                        disabled={confirmed}
                        onChange={(event) =>
                          setOrderInputs((inputs) => ({ ...inputs, [product.id]: event.target.value }))
                        }
                      />
                    </label>
                  </article>
                )
              })}
            </div>
          </section>
        ) : null}
      </div>

      <div className="section-head compact-head">
        <div>
          <p className="eyebrow">Today Purchase List</p>
          <h2>{confirmedProducts.length} confirmed</h2>
        </div>
      </div>

      <div className="confirmed-list">
        {confirmedProducts.length === 0 ? (
          <EmptyState text="No confirmed items yet." />
        ) : (
          confirmedProducts.map((product) => {
            const row = draft[product.id]
            const currentStock = numberValue(row.currentChecked)
            const neededQty = numberValue(row.neededQty ?? Math.max(0, product.keepStockQty - currentStock))
            const finalQty = numberValue(row.finalOrderQty)
            const costPrice = numberValue(row.buyingPrice ?? product.defaultBuyingPrice)
            return (
              <article className="confirmed-row" key={product.id}>
                <div className="product-title">
                  <strong>{productDisplayName(product)}</strong>
                  <span>Current {currentStock} pkt / Need {neededQty} pkt</span>
                </div>
                <div className="mini-stat need-stat need">
                  <span>Order</span>
                  <strong>{finalQty}</strong>
                </div>
                <div className="confirmed-money">
                  <span>{money(costPrice)} / pkt</span>
                  <strong>{money(finalQty * costPrice)}</strong>
                </div>
                <div className="row-actions">
                  <button className="danger-button" onClick={() => removeProduct(product)}>Remove</button>
                </div>
              </article>
            )
          })
        )}
      </div>

      <div className="po-bulk-actions">
        <button
          className="ghost-button"
          disabled={!selectedSupplierId || !selectedBrand}
          onClick={confirmSelectedOrders}
        >
          Confirm Selected Orders
        </button>
        <button className="glow-button" onClick={createPurchaseOrders}>Create Purchase Order</button>
      </div>

      <div className="sticky-action">
        <div>
          <span>Total qty</span>
          <strong>{totals.qty} pkt <em>|</em> {money(totals.value)}</strong>
        </div>
      </div>
      {previewOrder ? (
        <PurchaseOrderPreview order={previewOrder} onClose={() => setPreviewOrder(null)} />
      ) : null}
    </section>
  )
}

function SettingsPage({
  activeTab,
  onTabChange,
  orders,
  productById,
  onReceive,
  syncNotice,
  products,
  suppliers,
  duitStock,
  editingProduct,
  onEditProduct,
  onSaveProduct,
  onDeleteProduct,
  editingSupplier,
  onEditSupplier,
  onSaveSupplier,
  onDeleteSupplier,
}) {
  return (
    <section className="page-stack">
      <div className="section-head">
        <div>
          <p className="eyebrow">Settings</p>
          <h2>Settings</h2>
        </div>
      </div>

      <nav className="sub-tabs" aria-label="Settings sections">
        {[
          ['orders', 'Orders'],
          ['products', 'Products'],
          ['suppliers', 'Suppliers'],
        ].map(([id, label]) => (
          <button
            key={id}
            className={activeTab === id ? 'active' : ''}
            onClick={() => onTabChange(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {activeTab === 'orders' && (
        <UpcomingOrders
          orders={orders}
          productById={productById}
          onReceive={onReceive}
          syncNotice={syncNotice}
        />
      )}

      {activeTab === 'products' && (
        <ProductsPage
          products={products}
          suppliers={suppliers}
          duitStock={duitStock}
          editingProduct={editingProduct}
          onEdit={onEditProduct}
          onSave={onSaveProduct}
          onDelete={onDeleteProduct}
        />
      )}

      {activeTab === 'suppliers' && (
        <SuppliersPage
          suppliers={suppliers}
          products={products}
          editingSupplier={editingSupplier}
          onEdit={onEditSupplier}
          onSave={onSaveSupplier}
          onDelete={onDeleteSupplier}
        />
      )}
    </section>
  )
}

function UpcomingOrders({ orders, onReceive, syncNotice }) {
  const [previewOrder, setPreviewOrder] = useState(null)

  return (
    <section className="page-stack">
      <div className="section-head">
        <div>
          <p className="eyebrow">Upcoming Orders</p>
          <h2>Grouped by supplier</h2>
        </div>
      </div>
      {syncNotice ? <div className="success-badge">✓ {syncNotice}</div> : null}
      {orders.length === 0 ? (
        <EmptyState text="No upcoming supplier orders." />
      ) : (
        orders.map((order) => {
          const totalQty = order.items.reduce((sum, item) => sum + item.finalOrderQty, 0)
          const totalValue = order.items.reduce((sum, item) => sum + item.finalOrderQty * item.buyingPrice, 0)

          return (
            <article className="order-card order-summary-card" key={order.id}>
              <div>
                <h3>{order.supplierName}</h3>
                <span>Order date {order.orderDate}</span>
              </div>
              <div className="order-summary-metrics">
                <div><strong>{order.items.length}</strong><span>Products</span></div>
                <div><strong>{totalQty}</strong><span>Packets</span></div>
                <div><strong>{money(totalValue)}</strong><span>Total value</span></div>
              </div>
              <div className="order-card-actions">
                <button className="glow-button compact" onClick={() => setPreviewOrder(order)}>Open</button>
                <button className="ghost-button compact" onClick={() => onReceive(order.id)}>Receive</button>
              </div>
            </article>
          )
        })
      )}
      {previewOrder ? (
        <PurchaseOrderPreview order={previewOrder} onClose={() => setPreviewOrder(null)} />
      ) : null}
    </section>
  )
}

function PurchaseOrderPreview({ order, onClose }) {
  const poNumber = `PO-${order.orderDate.replaceAll('-', '')}-${order.id.slice(-4).toUpperCase()}`
  const totalQty = order.items.reduce((sum, item) => sum + numberValue(item.finalOrderQty), 0)
  const createdBy = 'MagicOrder Staff'

  const buildShareText = () => [
    'MagicOrder',
    'Purchase Order',
    `Supplier Name: ${order.supplierName}`,
    `PO Number: ${poNumber}`,
    `Order Date: ${order.orderDate}`,
    `Created By: ${createdBy}`,
    '',
    ...order.items.map((item, index) => `${index + 1}. ${item.productName} - ${item.finalOrderQty} pkt`),
    '',
    `Total Qty: ${totalQty} pkt`,
    'Notes: Please deliver according to the listed quantities.',
  ].join('\n')

  const drawPurchaseOrder = () => {
    const width = 900
    const rowHeight = 46
    const height = 360 + order.items.length * rowHeight
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.fillStyle = '#111111'
    ctx.font = '700 34px Ubuntu, Arial, sans-serif'
    ctx.fillText('MagicOrder', 48, 58)
    ctx.font = '700 26px Ubuntu, Arial, sans-serif'
    ctx.fillText('Purchase Order', 48, 96)

    ctx.font = '400 18px Ubuntu, Arial, sans-serif'
    const meta = [
      [`Supplier Name`, order.supplierName],
      [`PO Number`, poNumber],
      [`Order Date`, order.orderDate],
      [`Created By`, createdBy],
    ]
    meta.forEach(([label, value], index) => {
      const y = 138 + index * 28
      ctx.fillStyle = '#555555'
      ctx.fillText(`${label}:`, 48, y)
      ctx.fillStyle = '#111111'
      ctx.fillText(String(value), 190, y)
    })

    const tableTop = 270
    ctx.fillStyle = '#f2f2f2'
    ctx.fillRect(48, tableTop, width - 96, 44)
    ctx.fillStyle = '#111111'
    ctx.font = '700 18px Ubuntu, Arial, sans-serif'
    ctx.fillText('No.', 68, tableTop + 28)
    ctx.fillText('Product Name', 130, tableTop + 28)
    ctx.fillText('Qty (pkt)', 760, tableTop + 28)

    ctx.font = '400 18px Ubuntu, Arial, sans-serif'
    order.items.forEach((item, index) => {
      const y = tableTop + 44 + index * rowHeight
      ctx.strokeStyle = '#dddddd'
      ctx.beginPath()
      ctx.moveTo(48, y)
      ctx.lineTo(width - 48, y)
      ctx.stroke()
      ctx.fillStyle = '#111111'
      ctx.fillText(String(index + 1), 68, y + 30)
      ctx.fillText(item.productName, 130, y + 30)
      ctx.fillText(String(item.finalOrderQty), 790, y + 30)
    })

    const bottom = tableTop + 64 + order.items.length * rowHeight
    ctx.font = '700 20px Ubuntu, Arial, sans-serif'
    ctx.fillText(`Total Qty: ${totalQty} pkt`, 48, bottom)
    ctx.font = '400 18px Ubuntu, Arial, sans-serif'
    ctx.fillStyle = '#333333'
    ctx.fillText('Notes: Please deliver according to the listed quantities.', 48, bottom + 44)
    return canvas
  }

  const saveImage = () => {
    const canvas = drawPurchaseOrder()
    const link = document.createElement('a')
    link.download = `${poNumber}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  const shareWhatsApp = () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(buildShareText())}`, '_blank', 'noopener,noreferrer')
  }

  const printOrder = () => {
    const printWindow = window.open('', '_blank', 'noopener,noreferrer')
    if (!printWindow) return
    printWindow.document.write(`
      <html>
        <head>
          <title>${poNumber}</title>
          <style>
            body { font-family: Ubuntu, Arial, sans-serif; color: #111; padding: 32px; }
            h1 { margin: 0 0 4px; font-size: 30px; }
            h2 { margin: 0 0 22px; font-size: 22px; }
            .meta { display: grid; gap: 6px; margin-bottom: 24px; }
            table { width: 100%; border-collapse: collapse; }
            th, td { border-bottom: 1px solid #ddd; padding: 10px; text-align: left; }
            th { background: #f2f2f2; }
            .qty { text-align: right; }
            .total { margin-top: 18px; font-weight: 700; }
            .notes { margin-top: 24px; }
          </style>
        </head>
        <body>
          <h1>MagicOrder</h1>
          <h2>Purchase Order</h2>
          <div class="meta">
            <div><strong>Supplier Name:</strong> ${order.supplierName}</div>
            <div><strong>PO Number:</strong> ${poNumber}</div>
            <div><strong>Order Date:</strong> ${order.orderDate}</div>
            <div><strong>Created By:</strong> ${createdBy}</div>
          </div>
          <table>
            <thead><tr><th>No.</th><th>Product Name</th><th class="qty">Qty (pkt)</th></tr></thead>
            <tbody>
              ${order.items.map((item, index) => `
                <tr><td>${index + 1}</td><td>${item.productName}</td><td class="qty">${item.finalOrderQty}</td></tr>
              `).join('')}
            </tbody>
          </table>
          <div class="total">Total Qty: ${totalQty} pkt</div>
          <div class="notes">Notes: Please deliver according to the listed quantities.</div>
        </body>
      </html>
    `)
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
  }

  return (
    <div className="po-modal-backdrop" role="dialog" aria-modal="true" aria-label="Purchase Order Preview">
      <div className="po-modal">
        <div className="po-preview">
          <header>
            <div>
              <h2>MagicOrder</h2>
              <h3>Purchase Order</h3>
            </div>
          </header>
          <div className="po-meta">
            <span>Supplier Name</span><strong>{order.supplierName}</strong>
            <span>PO Number</span><strong>{poNumber}</strong>
            <span>Order Date</span><strong>{order.orderDate}</strong>
            <span>Created By</span><strong>{createdBy}</strong>
          </div>
          <table>
            <thead>
              <tr>
                <th>No.</th>
                <th>Product Name</th>
                <th>Qty (pkt)</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((item, index) => (
                <tr key={item.productId}>
                  <td>{index + 1}</td>
                  <td>{item.productName}</td>
                  <td>{item.finalOrderQty}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="po-total">Total Qty: {totalQty} pkt</div>
          <p className="po-notes">Notes: Please deliver according to the listed quantities.</p>
        </div>
        <div className="po-actions">
          <button className="ghost-button" onClick={saveImage}>Save Image</button>
          <button className="ghost-button" onClick={printOrder}>Print</button>
          <button className="ghost-button" onClick={shareWhatsApp}>Share</button>
          <button className="glow-button compact" onClick={onClose}>OK</button>
        </div>
      </div>
    </div>
  )
}

function ReceiveOrder({ order, onConfirm, onBack }) {
  const [receivedRows, setReceivedRows] = useState(() =>
    Object.fromEntries((order?.items || []).map((item) => [item.productId, item.finalOrderQty])),
  )

  if (!order) {
    return (
      <section className="page-stack">
        <EmptyState text="Order not found." />
        <button className="ghost-button" onClick={onBack}>Back</button>
      </section>
    )
  }

  const receivedValue = order.items.reduce(
    (sum, item) => sum + numberValue(receivedRows[item.productId]) * item.buyingPrice,
    0,
  )

  return (
    <section className="page-stack with-sticky">
      <div className="section-head">
        <div>
          <p className="eyebrow">Receive Order</p>
          <h2>{order.supplierName}</h2>
        </div>
        <button className="ghost-button" onClick={onBack}>Back</button>
      </div>

      <div className="list-table">
        <div className="receive-header">
          <span>Product</span>
          <span>Ordered</span>
          <span>Received</span>
          <span>Value</span>
        </div>
        {order.items.map((item) => (
          <article className="receive-row" key={item.productId}>
            <div className="product-title">
              <strong>{item.productName}</strong>
              <span>{money(item.buyingPrice)} / pkt</span>
            </div>
            <div className="mini-stat keep-stat">
              <span>Ordered</span>
              <strong>{item.finalOrderQty}</strong>
            </div>
            <label>
              <span>Received</span>
              <input
                type="number"
                min="0"
                inputMode="numeric"
                value={receivedRows[item.productId] ?? 0}
                onChange={(event) =>
                  setReceivedRows((rows) => ({ ...rows, [item.productId]: event.target.value }))
                }
              />
            </label>
            <div className="mini-stat need-stat need">
              <span>Value</span>
              <strong>{money(numberValue(receivedRows[item.productId]) * item.buyingPrice)}</strong>
            </div>
          </article>
        ))}
      </div>

      <div className="sticky-action">
        <div>
          <span>Received value</span>
          <strong>{money(receivedValue)}</strong>
        </div>
        <button className="glow-button" onClick={() => onConfirm(order.id, receivedRows)}>
          Confirm Receive & Close
        </button>
      </div>
    </section>
  )
}

function ProductsPage({ products, suppliers, duitStock, editingProduct, onEdit, onSave, onDelete }) {
  const blankProduct = {
    id: '',
    name: '',
    brand: '',
    flavour: '',
    keepStockQty: 0,
    currentStock: 0,
    costPrice: 0,
    defaultSupplierId: suppliers[0]?.id || '',
    defaultBuyingPrice: 0,
    barcode: '',
    active: true,
  }
  const typeOptions = Array.from(
    new Set([...PRODUCT_TYPE_OPTIONS, ...products.map((product) => product.flavour).filter(Boolean)]),
  )

  return (
    <section className="page-stack">
      <div className="section-head">
        <div>
          <p className="eyebrow">Products</p>
          <h2>Stock master list</h2>
        </div>
        <button className="glow-button compact" onClick={() => onEdit(blankProduct)}>Add</button>
      </div>

      {editingProduct && (
        <ProductForm
          key={editingProduct.id || 'new-product'}
          product={{
            ...editingProduct,
            currentStock: duitStock[editingProduct.id]?.qty ?? editingProduct.currentStock ?? 0,
            costPrice: editingProduct.defaultBuyingPrice ?? editingProduct.costPrice ?? 0,
          }}
          typeOptions={typeOptions}
          onSave={onSave}
          onCancel={() => onEdit(null)}
        />
      )}

      <div className="card-grid">
        {products.map((product) => (
          <article className="entity-card" key={product.id}>
            <div>
              <h3>{productDisplayName(product)}</h3>
              <span>{duitStock[product.id]?.qty || 0} pkt current / {product.keepStockQty} pkt default</span>
              <p>{money(product.defaultBuyingPrice)} per packet</p>
            </div>
            <div className="entity-actions">
              <button className="ghost-button" onClick={() => onEdit(product)}>Edit</button>
              <button className="danger-button" onClick={() => onDelete(product.id)}>Delete</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function ProductForm({ product, typeOptions, onSave, onCancel }) {
  const [form, setForm] = useState(product)
  const initialType = typeOptions.includes(product.flavour) ? product.flavour : 'Add new'
  const [selectedType, setSelectedType] = useState(initialType)
  const [newType, setNewType] = useState(initialType === 'Add new' ? product.flavour : '')
  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }))
  const handleSubmit = (event) => {
    event.preventDefault()
    onSave({
      ...form,
      flavour: selectedType === 'Add new' ? newType : selectedType,
    })
  }

  return (
    <form className="editor-panel product-editor" onSubmit={handleSubmit}>
      <label>
        <span>Brand</span>
        <input value={form.brand} onChange={(event) => update('brand', event.target.value)} placeholder="DUNHILL, MARLBORO" required />
      </label>
      <label>
        <span>Type</span>
        <select value={selectedType} onChange={(event) => setSelectedType(event.target.value)}>
          <option value="Add new">Add new</option>
          {typeOptions.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
      </label>
      {selectedType === 'Add new' ? (
        <label>
          <span>New type</span>
          <input value={newType} onChange={(event) => setNewType(event.target.value)} placeholder="Red, Blue, Black Menthol, Ice Blast" required />
        </label>
      ) : null}
      <div className="stock-price-row">
        <label>
          <span>Current stock</span>
          <input type="number" min="0" inputMode="numeric" value={form.currentStock} onChange={(event) => update('currentStock', event.target.value)} placeholder="Packets" />
        </label>
        <label>
          <span>Cost price</span>
          <input type="number" min="0" step="0.01" inputMode="decimal" value={form.costPrice ?? form.defaultBuyingPrice} onChange={(event) => update('costPrice', event.target.value)} placeholder="17.80" />
        </label>
      </div>
      <label>
        <span>Default stock (packets)</span>
        <input type="number" min="0" inputMode="numeric" value={form.keepStockQty} onChange={(event) => update('keepStockQty', event.target.value)} placeholder="Packets" />
      </label>
      <div className="form-actions">
        <button className="ghost-button" type="button" onClick={onCancel}>Cancel</button>
        <button className="glow-button compact" type="submit">Save product</button>
      </div>
    </form>
  )
}

function SuppliersPage({ suppliers, products, editingSupplier, onEdit, onSave, onDelete }) {
  const blankSupplier = { id: '', name: '', phone: '', notes: '', brands: '' }

  return (
    <section className="page-stack">
      <div className="section-head">
        <div>
          <p className="eyebrow">Suppliers</p>
          <h2>Supplier directory</h2>
        </div>
        <button className="glow-button compact" onClick={() => onEdit(blankSupplier)}>Add</button>
      </div>

      {editingSupplier && (
        <SupplierForm
          supplier={editingSupplier}
          onSave={onSave}
          onCancel={() => onEdit(null)}
        />
      )}

      <div className="card-grid">
        {suppliers.map((supplier) => {
          const suppliedProducts = products.filter((product) => product.defaultSupplierId === supplier.id)
          return (
            <article className="entity-card" key={supplier.id}>
              <div>
                <h3>{supplier.name}</h3>
                <p>{supplier.phone || 'No phone'}</p>
                <span>{supplier.brands || suppliedProducts.map((product) => product.brand).join(', ')}</span>
              </div>
              <p className="notes">{supplier.notes}</p>
              <div className="entity-actions">
                <button className="ghost-button" onClick={() => onEdit(supplier)}>Edit</button>
                <button className="danger-button" onClick={() => onDelete(supplier.id)}>Delete</button>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

function SupplierForm({ supplier, onSave, onCancel }) {
  const [form, setForm] = useState(supplier)
  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }))

  return (
    <form className="editor-panel" onSubmit={(event) => { event.preventDefault(); onSave(form) }}>
      <input value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="Supplier name" required />
      <input value={form.phone} onChange={(event) => update('phone', event.target.value)} placeholder="Phone" />
      <input value={form.brands} onChange={(event) => update('brands', event.target.value)} placeholder="Brands/products supplied" />
      <textarea value={form.notes} onChange={(event) => update('notes', event.target.value)} placeholder="Notes" />
      <div className="form-actions">
        <button className="ghost-button" type="button" onClick={onCancel}>Cancel</button>
        <button className="glow-button compact" type="submit">Save supplier</button>
      </div>
    </form>
  )
}

function EmptyState({ text }) {
  return <div className="empty-state">{text}</div>
}

export default App
