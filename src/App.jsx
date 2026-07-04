import { useEffect, useMemo, useRef, useState } from 'react'
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore'
import './App.css'
import { db } from './firebase'

const todayKey = () => new Date().toISOString().slice(0, 10)
const money = (value) => `RM ${Number(value || 0).toFixed(2)}`
const costMoney = (value) => `RM ${Number(value || 0).toFixed(3)}`
const numberValue = (value) => Math.max(0, Number(value) || 0)
const formatCtnQty = (value = 0) => {
  const qty = numberValue(value)
  const formatted = Number.isInteger(qty) ? String(qty) : qty.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
  return `${formatted} CTN`
}
const formatOrderQty = formatCtnQty
const roundUpCartons = (value = 0) => Math.ceil(numberValue(value))
const makeId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
const productDisplayName = (product) => `${product.brand || ''} ${product.flavour || ''}`.trim() || product.name
const syncTime = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const dateKeyFrom = (value) => {
  if (!value) return ''
  if (typeof value === 'string') return value.slice(0, 10)
  if (typeof value.toDate === 'function') return value.toDate().toISOString().slice(0, 10)
  return ''
}

const createInitialState = () => ({
  products: [],
  suppliers: [],
  checks: {},
  stockChecks: [],
  orders: [],
})

function App() {
  const [data, setData] = useState(createInitialState)
  const [page, setPage] = useState('dashboard')
  const [settingsTab, setSettingsTab] = useState('orders')
  const [receivingOrderId, setReceivingOrderId] = useState(null)
  const [syncNotice, setSyncNotice] = useState('')
  const [cloudSync, setCloudSync] = useState({ enabled: false, lastSynced: '', error: '' })
  const [installPrompt, setInstallPrompt] = useState(null)
  const [editingProduct, setEditingProduct] = useState(null)
  const [editingSupplier, setEditingSupplier] = useState(null)
  const currentDay = todayKey()

  const markSynced = () => setCloudSync({ enabled: true, lastSynced: syncTime(), error: '' })
  const markSyncError = (error) => setCloudSync({ enabled: false, lastSynced: '', error: error.message })

  useEffect(() => {
    const productsQuery = query(collection(db, 'products'), orderBy('name'))
    const suppliersQuery = query(collection(db, 'suppliers'), orderBy('name'))
    const ordersQuery = query(collection(db, 'purchaseOrders'), orderBy('createdAt', 'desc'))

    const unsubProducts = onSnapshot(productsQuery, (snapshot) => {
      setData((current) => ({
        ...current,
        products: snapshot.docs.map((item) => ({ id: item.id, ...item.data() })),
      }))
      markSynced()
    }, markSyncError)

    const unsubSuppliers = onSnapshot(suppliersQuery, (snapshot) => {
      setData((current) => ({
        ...current,
        suppliers: snapshot.docs.map((item) => ({ id: item.id, ...item.data() })),
      }))
      markSynced()
    }, markSyncError)

    const unsubOrders = onSnapshot(ordersQuery, (snapshot) => {
      setData((current) => ({
        ...current,
        orders: snapshot.docs.map((item) => ({ id: item.id, ...item.data() })),
      }))
      markSynced()
    }, markSyncError)

    return () => {
      unsubProducts()
      unsubSuppliers()
      unsubOrders()
    }
  }, [])

  useEffect(() => {
    if (!syncNotice) return undefined
    const timer = window.setTimeout(() => setSyncNotice(''), 4000)
    return () => window.clearTimeout(timer)
  }, [syncNotice])

  useEffect(() => {
    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault()
      setInstallPrompt(event)
    }
    const handleInstalled = () => setInstallPrompt(null)

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleInstalled)
    }
  }, [])

  const installApp = async () => {
    if (!installPrompt) return
    installPrompt.prompt()
    await installPrompt.userChoice
    setInstallPrompt(null)
  }

  const todayDraft = useMemo(() => data.checks[currentDay] || {}, [currentDay, data.checks])
  const upcomingOrders = data.orders.filter((order) => order.status === 'upcoming')
  const receivedTodayOrders = data.orders.filter(
    (order) => order.status === 'closed' && dateKeyFrom(order.receivedAt) === currentDay,
  )
  const duitStock = useMemo(
    () =>
      Object.fromEntries(
        data.products.map((product) => [
          product.id,
          {
            qty: numberValue(product.currentStock),
            value: numberValue(product.currentStock) * numberValue(product.defaultBuyingPrice),
          },
        ]),
      ),
    [data.products],
  )

  const stats = useMemo(() => {
    const todayOrders = data.orders.filter((order) => dateKeyFrom(order.createdAt) === currentDay)
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

  const createSupplierOrders = async ({ stayOnPage = false } = {}) => {
    const grouped = data.products.reduce((groups, product) => {
      const row = todayDraft[product.id]
      const finalOrderQty = roundUpCartons(row?.finalOrderQty)
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
    await Promise.all(
      orders.map((order) =>
        setDoc(doc(db, 'purchaseOrders', order.id), {
          ...order,
          supplier: {
            id: order.supplierId,
            name: order.supplierName,
          },
          products: order.items.map((item) => ({
            productId: item.productId,
            productName: item.productName,
            qty: item.finalOrderQty,
          })),
          syncedAt: serverTimestamp(),
        }),
      ),
    )
    setSyncNotice('Purchase order synced')
    if (!stayOnPage) {
      setSettingsTab('orders')
      setPage('settings')
    }
    return orders
  }

  const confirmReceive = async (orderId, receivedRows) => {
    const order = data.orders.find((item) => item.id === orderId)
    if (!order) return
    const receivedAt = new Date().toISOString()
    const batch = writeBatch(db)
    const items = order.items.map((item) => {
      const receivedQty = numberValue(receivedRows[item.productId])
      const product = productById[item.productId]
      const currentStock = numberValue(product?.currentStock)
      batch.set(
        doc(db, 'products', item.productId),
        { currentStock: currentStock + receivedQty, updatedAt: serverTimestamp() },
        { merge: true },
      )
      return { ...item, receivedQty }
    })

    batch.set(doc(db, 'purchaseOrders', orderId), {
      ...order,
      items,
      status: 'closed',
      receivedAt,
      updatedAt: serverTimestamp(),
    })
    batch.set(doc(collection(db, 'receiveHistory')), {
      orderId,
      supplierId: order.supplierId,
      supplierName: order.supplierName,
      items,
      receivedAt,
      createdAt: serverTimestamp(),
    })
    await batch.commit()
    setSyncNotice('Synced to DuitStock')
    setReceivingOrderId(null)
    setSettingsTab('orders')
    setPage('settings')
  }

  const saveStockCheckRecords = async (records) => {
    if (!records.length) return
    const checkedAt = new Date().toISOString()
    const batch = writeBatch(db)
    records.forEach((record) => {
      batch.set(doc(collection(db, 'stockChecks')), {
        ...record,
        checkedAt,
        createdAt: serverTimestamp(),
      })
      batch.set(
        doc(db, 'products', record.productId),
        { currentStock: record.totalQty, updatedAt: serverTimestamp() },
        { merge: true },
      )
    })
    await batch.commit()
    setSyncNotice('Stock check synced')
  }

  const saveProduct = async (form) => {
    const productId = form.id || makeId('prd')
    const brand = form.brand.trim()
    const type = form.flavour.trim()
    const product = {
      ...form,
      id: productId,
      name: `${brand} ${type}`.trim(),
      brand,
      flavour: type,
      keepStockQty: numberValue(form.keepStockQty),
      currentStock: numberValue(form.currentStock),
      defaultBuyingPrice: numberValue(form.costPrice ?? form.defaultBuyingPrice),
      sellingPrice: numberValue(form.sellingPrice),
      defaultSupplierId: form.defaultSupplierId || data.suppliers[0]?.id || '',
      barcode: form.barcode || '',
      active: true,
      updatedAt: serverTimestamp(),
    }
    await setDoc(doc(db, 'products', productId), product, { merge: true })

    const brandKey = brand.toLowerCase()
    const siblingProducts = data.products.filter(
      (existing) => existing.id !== productId && (existing.brand || '').trim().toLowerCase() === brandKey,
    )
    if (siblingProducts.length) {
      const priceBatch = writeBatch(db)
      siblingProducts.forEach((existing) => {
        priceBatch.set(
          doc(db, 'products', existing.id),
          { sellingPrice: numberValue(form.sellingPrice), updatedAt: serverTimestamp() },
          { merge: true },
        )
      })
      await priceBatch.commit()
    }

    setSyncNotice('Product synced')
    if (form.id) {
      setEditingProduct(null)
    }
  }

  const deleteProduct = async (productId) => {
    await deleteDoc(doc(db, 'products', productId))
    setSyncNotice('Product deleted')
  }

  const saveSupplier = async (form) => {
    const supplierId = form.id || makeId('sup')
    await setDoc(doc(db, 'suppliers', supplierId), {
      ...form,
      id: supplierId,
      updatedAt: serverTimestamp(),
    }, { merge: true })
    setSyncNotice('Supplier synced')
    setEditingSupplier(null)
  }

  const deleteSupplier = async (supplierId) => {
    await deleteDoc(doc(db, 'suppliers', supplierId))
    setSyncNotice('Supplier deleted')
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
          <div className="topbar-actions">
            <div className={`cloud-badge ${cloudSync.enabled ? 'online' : 'offline'}`}>
              <strong>{cloudSync.enabled ? 'Cloud Sync ON' : 'Cloud Sync OFF'}</strong>
              <span>{cloudSync.enabled ? `Last synced ${cloudSync.lastSynced}` : cloudSync.error || 'Connecting...'}</span>
            </div>
            {installPrompt ? (
              <button className="install-button" onClick={installApp}>Install App</button>
            ) : null}
            <div className="date-pill">{currentDay}</div>
          </div>
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
              duitStock={duitStock}
              products={data.products}
              onGoCheck={() => setPage('stock')}
            />
          )}

          {page === 'stock' && (
            <StockCheckPage
              products={data.products}
              duitStock={duitStock}
              onSaveStockChecks={saveStockCheckRecords}
            />
          )}

          {page === 'check' && (
            <PurchaseOrderPage
              products={data.products}
              suppliers={data.suppliers}
              duitStock={duitStock}
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
              duitStock={duitStock}
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
          <p className="eyebrow">Carton stock</p>
          <h2>Supplier orders from physical stock checks.</h2>
        </div>
        <button className="glow-button" onClick={onGoCheck}>Start check</button>
      </div>

      <div className="summary-grid">
        <SummaryCard label="Total cost of stock" value={money(dashboard.totalStockCost)} />
        <SummaryCard label="Total qty of cigarette" value={formatCtnQty(dashboard.totalStockQty)} />
        <SummaryCard label="Today's total order qty" value={formatOrderQty(stats.orderQty)} />
        <SummaryCard label="Today's total order amount" value={money(stats.orderValue)} />
      </div>

      <DashboardSection title="High stock value products">
        {dashboard.highValue.map((row) => (
          <DashboardRow
            key={row.product.id}
            title={row.name}
            left={`${formatCtnQty(row.currentQty)} current`}
            right={money(row.stockValue)}
          />
        ))}
      </DashboardSection>

      <DashboardSection title="Low stock products">
        {dashboard.lowStock.map((row) => (
          <DashboardRow
            key={row.product.id}
            title={row.name}
            left={`${formatCtnQty(row.currentQty)} current / ${formatCtnQty(row.defaultStock)} default`}
            right={`${formatCtnQty(Math.max(0, row.defaultStock - row.currentQty))} shortage`}
          />
        ))}
      </DashboardSection>

      <DashboardSection title="Fast moving products">
        {dashboard.fastMoving.length ? (
          dashboard.fastMoving.map((row) => (
            <DashboardRow
              key={row.product.id}
              title={row.name}
              left={`${formatCtnQty(row.qty)} moved`}
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
              left={`${formatCtnQty(row.qty)} moved`}
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
            <strong>{formatOrderQty(stats.orderQty)}</strong>
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
    return numberValue(row.rackCartons) + numberValue(row.storeCartons)
  }
  const hasEnteredRow = (productId) => {
    const row = getAreaRow(productId)
    return ['rackCartons', 'storeCartons'].some((field) => row[field] !== undefined && row[field] !== '')
  }

  const buildRecord = (product) => {
    const row = getAreaRow(product.id)
    return {
      productId: product.id,
      brand: product.brand,
      type: product.flavour,
      rackQty: numberValue(row.rackCartons),
      storeQty: numberValue(row.storeCartons),
      totalQty: getAreaTotal(product.id),
      defaultStock: numberValue(product.keepStockQty),
    }
  }

  const confirmProduct = async (product) => {
    const record = buildRecord(product)
    await onSaveStockChecks([record])
    setCheckedProducts((current) => ({ ...current, [product.id]: true }))
    setSuccessMessage(`${productDisplayName(product)} checked`)
  }

  const enteredProducts = products.filter((product) => hasEnteredRow(product.id))
  const summaryQty = enteredProducts.reduce((sum, product) => sum + getAreaTotal(product.id), 0)

  const saveAllChecked = async () => {
    const records = enteredProducts.map(buildRecord)
    if (!records.length) return
    await onSaveStockChecks(records)
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
                    <strong className="stock-check-total">Total: {totalQty} CTN</strong>
                    <button className="glow-button compact" onClick={() => confirmProduct(product)}>
                      SC
                    </button>
                  </div>
                  <div className="stock-check-meta">
                    Default: {formatCtnQty(product.keepStockQty)} | Current: {formatCtnQty(currentQty)}
                  </div>
                  <div className="stock-area-inputs">
                    <label>
                      <span>Rack CTN</span>
                      <input
                        type="number"
                        min="0"
                        inputMode="numeric"
                        value={row.rackCartons ?? ''}
                        onChange={(event) => updateArea(product.id, 'rackCartons', event.target.value)}
                      />
                    </label>
                    <label>
                      <span>Store CTN</span>
                      <input
                        type="number"
                        min="0"
                        inputMode="numeric"
                        value={row.storeCartons ?? ''}
                        onChange={(event) => updateArea(product.id, 'storeCartons', event.target.value)}
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
          <strong>{summaryQty} CTN counted</strong>
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
  const selectedSupplier = useMemo(
    () => suppliers.find((supplier) => supplier.id === selectedSupplierId) || null,
    [suppliers, selectedSupplierId],
  )
  const supplierBrandNames = useMemo(
    () => (selectedSupplier?.brands || '').split(',').map((brand) => brand.trim()).filter(Boolean),
    [selectedSupplier],
  )
  const supplierProducts = useMemo(
    () =>
      selectedSupplierId
        ? products.filter((product) =>
            supplierBrandNames.some((brand) => brand.toLowerCase() === product.brand?.trim().toLowerCase()),
          )
        : [],
    [products, selectedSupplierId, supplierBrandNames],
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
  const getRoundedOrderQty = (product) => roundUpCartons(getNeededQty(product))
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
    const orderCartons = numberValue(getOrderInput(product))
    const finalOrderQty = roundUpCartons(orderCartons)
    if (orderCartons <= 0) return
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

  const createPurchaseOrders = async () => {
    const createdOrders = await onCreateOrders({ stayOnPage: true })
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

        <label className="search-field brand-chooser">
          <span>Brand</span>
          <select
            value={selectedBrand}
            disabled={!selectedSupplierId}
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
          {selectedSupplierId && supplierBrands.length === 0 ? (
            <small className="field-hint">No brands linked to this supplier</small>
          ) : null}
        </label>

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
                        Current: {formatCtnQty(currentStock)} <em>|</em> Default: {formatCtnQty(product.keepStockQty)} <em>|</em> Required: {formatCtnQty(neededQty)}
                      </span>
                      {confirmed ? <span className="confirmed-badge">Confirmed</span> : null}
                    </div>
                    <div className="po-cost">
                      <span>Cost price</span>
                      <strong>{costMoney(product.defaultBuyingPrice)}</strong>
                    </div>
                    <label className={autoFillHighlights[product.id] ? 'order-autofilled' : ''}>
                      <span>Order qty (CTN)</span>
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
                  <span>Current {formatCtnQty(currentStock)} / Need {formatCtnQty(neededQty)}</span>
                </div>
                <div className="mini-stat need-stat need">
                  <span>Order</span>
                  <strong>{formatOrderQty(finalQty)}</strong>
                </div>
                <div className="confirmed-money">
                  <span>{costMoney(costPrice)} / CTN</span>
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
          <strong>{formatOrderQty(totals.qty)} <em>|</em> {money(totals.value)}</strong>
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
                <div><strong>{formatOrderQty(totalQty)}</strong><span>Cartons</span></div>
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
    ...order.items.map((item, index) => `${index + 1}. ${item.productName} - ${formatOrderQty(item.finalOrderQty)}`),
    '',
    `Total Qty: ${formatOrderQty(totalQty)}`,
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
    ctx.fillText('Qty (CTN)', 760, tableTop + 28)

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
      ctx.fillText(formatOrderQty(item.finalOrderQty), 790, y + 30)
    })

    const bottom = tableTop + 64 + order.items.length * rowHeight
    ctx.font = '700 20px Ubuntu, Arial, sans-serif'
    ctx.fillText(`Total Qty: ${formatOrderQty(totalQty)}`, 48, bottom)
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
            <thead><tr><th>No.</th><th>Product Name</th><th class="qty">Qty (CTN)</th></tr></thead>
            <tbody>
              ${order.items.map((item, index) => `
                <tr><td>${index + 1}</td><td>${item.productName}</td><td class="qty">${formatOrderQty(item.finalOrderQty)}</td></tr>
              `).join('')}
            </tbody>
          </table>
          <div class="total">Total Qty: ${formatOrderQty(totalQty)}</div>
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
                <th>Qty (CTN)</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((item, index) => (
                <tr key={item.productId}>
                  <td>{index + 1}</td>
                  <td>{item.productName}</td>
                  <td>{formatOrderQty(item.finalOrderQty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="po-total">Total Qty: {formatOrderQty(totalQty)}</div>
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
  const confirmReceivedRows = () => {
    const rows = Object.fromEntries(
      order.items.map((item) => [item.productId, numberValue(receivedRows[item.productId])]),
    )
    onConfirm(order.id, rows)
  }

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
          <span>Received CTN</span>
          <span>Value</span>
        </div>
        {order.items.map((item) => (
          <article className="receive-row" key={item.productId}>
            <div className="product-title">
              <strong>{item.productName}</strong>
              <span>{costMoney(item.buyingPrice)} / CTN</span>
            </div>
            <div className="mini-stat keep-stat">
              <span>Ordered</span>
              <strong>{formatOrderQty(item.finalOrderQty)}</strong>
            </div>
            <label>
              <span>CTN</span>
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
              <strong>
                {money(numberValue(receivedRows[item.productId]) * item.buyingPrice)}
              </strong>
            </div>
          </article>
        ))}
      </div>

      <div className="sticky-action">
        <div>
          <span>Received value</span>
          <strong>{money(receivedValue)}</strong>
        </div>
        <button className="glow-button" onClick={confirmReceivedRows}>
          Confirm Receive & Close
        </button>
      </div>
    </section>
  )
}

function ProductsPage({ products, suppliers, duitStock, editingProduct, onEdit, onSave, onDelete }) {
  const [expandedBrand, setExpandedBrand] = useState('')
  const [importPreview, setImportPreview] = useState(null)
  const [importFileError, setImportFileError] = useState('')
  const [importBusy, setImportBusy] = useState(false)
  const fileInputRef = useRef(null)

  const exportProductsCsv = () => {
    const rows = [...products].sort(
      (a, b) => (a.brand || '').localeCompare(b.brand || '') || (a.flavour || '').localeCompare(b.flavour || ''),
    )
    const header = 'id,brand,flavour,currentStock,defaultStock,costPrice,sellingPrice'
    const lines = rows.map((p) =>
      [
        p.id,
        p.brand || '',
        p.flavour || '',
        numberValue(duitStock[p.id]?.qty ?? p.currentStock),
        numberValue(p.keepStockQty),
        numberValue(p.defaultBuyingPrice),
        numberValue(p.sellingPrice),
      ].join(','),
    )
    const csv = [header, ...lines].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `magicorder-products-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const parseCsvText = (text) => {
    const lines = text.trim().split(/\r?\n/)
    const header = lines[0].split(',').map((h) => h.trim())
    return lines.slice(1).filter(Boolean).map((line) => {
      const cells = line.split(',')
      const row = {}
      header.forEach((key, i) => { row[key] = (cells[i] ?? '').trim() })
      return row
    })
  }

  const handleImportFileChange = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setImportFileError('')
    try {
      const text = await file.text()
      const rows = parseCsvText(text)
      const productMap = Object.fromEntries(products.map((p) => [p.id, p]))
      const changes = []
      const skipped = []
      rows.forEach((row) => {
        const existing = productMap[row.id]
        if (!existing) {
          skipped.push(`${row.brand || ''} ${row.flavour || ''} (id ${row.id || 'missing'} not found)`.trim())
          return
        }
        const newDefaultStock = numberValue(row.defaultStock)
        const newCostPrice = numberValue(row.costPrice)
        const newSellingPrice = numberValue(row.sellingPrice)
        const stockChanged = numberValue(existing.keepStockQty) !== newDefaultStock
        const costChanged = numberValue(existing.defaultBuyingPrice) !== newCostPrice
        const sellingChanged = numberValue(existing.sellingPrice) !== newSellingPrice
        if (stockChanged || costChanged || sellingChanged) {
          changes.push({
            id: row.id,
            label: productDisplayName(existing),
            fromDefaultStock: numberValue(existing.keepStockQty),
            toDefaultStock: newDefaultStock,
            fromCostPrice: numberValue(existing.defaultBuyingPrice),
            toCostPrice: newCostPrice,
            fromSellingPrice: numberValue(existing.sellingPrice),
            toSellingPrice: newSellingPrice,
          })
        }
      })
      setImportPreview({ changes, skipped })
    } catch {
      setImportFileError('Could not read that file. Make sure it is a CSV exported from this app.')
    }
  }

  const applyImportChanges = async () => {
    if (!importPreview?.changes.length) return
    setImportBusy(true)
    try {
      const batchSize = 450
      for (let i = 0; i < importPreview.changes.length; i += batchSize) {
        const chunk = importPreview.changes.slice(i, i + batchSize)
        const batch = writeBatch(db)
        chunk.forEach((change) => {
          batch.set(
            doc(db, 'products', change.id),
            {
              keepStockQty: change.toDefaultStock,
              defaultBuyingPrice: change.toCostPrice,
              sellingPrice: change.toSellingPrice,
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          )
        })
        await batch.commit()
      }
      setImportPreview(null)
    } finally {
      setImportBusy(false)
    }
  }

  const blankProduct = {
    id: '',
    name: '',
    brand: '',
    flavour: '',
    keepStockQty: 20,
    currentStock: 0,
    costPrice: 0,
    sellingPrice: 0,
    defaultSupplierId: suppliers[0]?.id || '',
    defaultBuyingPrice: 0,
    barcode: '',
    active: true,
  }
  const productsByBrand = useMemo(() => {
    const groups = products.reduce((collection, product) => {
      const brand = product.brand || 'Unbranded'
      collection[brand] ||= []
      collection[brand].push(product)
      return collection
    }, {})

    return Object.entries(groups)
      .sort(([brandA], [brandB]) => brandA.localeCompare(brandB))
      .map(([brand, brandProducts]) => {
        const sortedProducts = [...brandProducts].sort((a, b) =>
          (a.flavour || productDisplayName(a)).localeCompare(b.flavour || productDisplayName(b)),
        )
        const totalStock = sortedProducts.reduce(
          (sum, product) => sum + numberValue(duitStock[product.id]?.qty ?? product.currentStock),
          0,
        )
        const totalValue = sortedProducts.reduce((sum, product) => {
          const qty = numberValue(duitStock[product.id]?.qty ?? product.currentStock)
          return sum + qty * numberValue(product.defaultBuyingPrice)
        }, 0)
        const brandSellingPrice = numberValue(sortedProducts[0]?.sellingPrice)
        const totalMarginValue = sortedProducts.reduce((sum, product) => {
          const qty = numberValue(duitStock[product.id]?.qty ?? product.currentStock)
          const margin = brandSellingPrice - numberValue(product.defaultBuyingPrice)
          return sum + qty * margin
        }, 0)
        return { brand, products: sortedProducts, totalStock, totalValue, sellingPrice: brandSellingPrice, totalMarginValue }
      })
  }, [duitStock, products])

  return (
    <section className="page-stack">
      <div className="section-head">
        <div>
          <p className="eyebrow">Products</p>
          <h2>Stock master list</h2>
        </div>
        <div className="products-header-actions">
          <button className="ghost-button compact" onClick={exportProductsCsv}>Export CSV</button>
          <button className="ghost-button compact" onClick={() => fileInputRef.current?.click()}>Import CSV</button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            style={{ display: 'none' }}
            onChange={handleImportFileChange}
          />
          <button className="glow-button compact" onClick={() => onEdit(blankProduct)}>Add</button>
        </div>
      </div>

      {importFileError ? <div className="empty-state">{importFileError}</div> : null}

      {editingProduct && (
        <ProductForm
          key={editingProduct.id || 'new-product'}
          product={{
            ...editingProduct,
            currentStock: duitStock[editingProduct.id]?.qty ?? editingProduct.currentStock ?? 0,
            costPrice: editingProduct.defaultBuyingPrice ?? editingProduct.costPrice ?? 0,
            sellingPrice: editingProduct.sellingPrice ?? 0,
          }}
          onSave={onSave}
          onCancel={() => onEdit(null)}
        />
      )}

      {importPreview ? (
        <div className="po-modal-backdrop" role="dialog" aria-modal="true" aria-label="Import preview">
          <div className="po-modal">
            <div className="po-preview">
              <header>
                <div>
                  <h2>Import Preview</h2>
                  <h3>{importPreview.changes.length} product(s) will change</h3>
                </div>
              </header>
              {importPreview.changes.length === 0 ? (
                <p>No changes detected — CSV matches current data.</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Default Stock</th>
                      <th>Cost Price</th>
                      <th>Selling Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importPreview.changes.map((change) => (
                      <tr key={change.id}>
                        <td>{change.label}</td>
                        <td>{formatCtnQty(change.fromDefaultStock)} {'->'} {formatCtnQty(change.toDefaultStock)}</td>
                        <td>{change.fromCostPrice} {'->'} {change.toCostPrice}</td>
                        <td>{change.fromSellingPrice} {'->'} {change.toSellingPrice}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {importPreview.skipped.length > 0 ? (
                <p className="po-notes">Skipped (not found): {importPreview.skipped.join(', ')}</p>
              ) : null}
            </div>
            <div className="po-actions">
              <button className="ghost-button" onClick={() => setImportPreview(null)} disabled={importBusy}>Cancel</button>
              <button
                className="glow-button compact"
                onClick={applyImportChanges}
                disabled={importBusy || importPreview.changes.length === 0}
              >
                {importBusy ? 'Applying...' : `Apply ${importPreview.changes.length} Change(s)`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="brand-product-groups">
        {productsByBrand.map(({ brand, products: brandProducts, totalStock, totalValue, sellingPrice, totalMarginValue }) => {
          const isExpanded = expandedBrand === brand
          return (
            <section className="product-brand-group" key={brand}>
              <button
                className={`product-brand-card ${isExpanded ? 'active' : ''}`}
                onClick={() => setExpandedBrand(isExpanded ? '' : brand)}
              >
                <span>
                  <strong>{brand}</strong>
                  <small>{brandProducts.length} products</small>
                </span>
                <span>
                  <small>Total stock</small>
                  <strong>{formatCtnQty(totalStock)}</strong>
                </span>
                <span>
                  <small>Total value</small>
                  <strong>{costMoney(totalValue)}</strong>
                </span>
              </button>
              <div className="product-brand-margin">
                <span>Selling price: {costMoney(sellingPrice)}</span>
                <span>Est. margin on hand: {costMoney(totalMarginValue)}</span>
              </div>

              {isExpanded ? (
                <div className="product-brand-details">
                  {brandProducts.map((product) => (
                    <article className="product-detail-row" key={product.id}>
                      <div className="product-title">
                        <strong>{productDisplayName(product)}</strong>
                        <span>{formatCtnQty(duitStock[product.id]?.qty || 0)} current / {formatCtnQty(product.keepStockQty)} default</span>
                        <p>{costMoney(product.defaultBuyingPrice)} cost | {costMoney(product.sellingPrice)} sell | {costMoney(numberValue(product.sellingPrice) - numberValue(product.defaultBuyingPrice))} margin</p>
                      </div>
                      <div className="entity-actions">
                        <button className="ghost-button" onClick={() => onEdit(product)}>Edit</button>
                        <button className="danger-button" onClick={() => onDelete(product.id)}>Delete</button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : null}
            </section>
          )
        })}
      </div>
    </section>
  )
}

function ProductForm({ product, onSave, onCancel }) {
  const [form, setForm] = useState(product)
  const flavourInputRef = useRef(null)
  const isNewProduct = !product.id
  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }))
  const handleSubmit = async (event) => {
    event.preventDefault()
    await onSave(form)
    if (isNewProduct) {
      setForm((current) => ({
        ...current,
        flavour: '',
        currentStock: 0,
        keepStockQty: 20,
      }))
      flavourInputRef.current?.focus()
    }
  }

  return (
    <form className="editor-panel product-editor" onSubmit={handleSubmit}>
      <label>
        <span>Brand</span>
        <input value={form.brand} onChange={(event) => update('brand', event.target.value)} placeholder="DUNHILL, MARLBORO" required />
      </label>
      <label>
        <span>Flavour / Type</span>
        <input ref={flavourInputRef} value={form.flavour} onChange={(event) => update('flavour', event.target.value)} placeholder="Red, Blue, Black Menthol, Ice Blast, Classic" required />
      </label>
      <div className="stock-price-row">
        <div className="stock-unit-row">
          <span>Current stock</span>
          <input type="number" min="0" step="0.1" inputMode="decimal" value={form.currentStock ?? 0} onChange={(event) => update('currentStock', event.target.value)} placeholder="0.0 CTN" />
        </div>
        <label>
          <span>Cost price</span>
          <input type="number" min="0" step="0.001" inputMode="decimal" value={form.costPrice ?? form.defaultBuyingPrice} onChange={(event) => update('costPrice', event.target.value)} placeholder="17.064" />
        </label>
      </div>
      <label>
        <span>Selling price (applies to all {form.brand || 'this brand'} flavours)</span>
        <input type="number" min="0" step="0.01" inputMode="decimal" value={form.sellingPrice ?? 0} onChange={(event) => update('sellingPrice', event.target.value)} placeholder="25.00" />
      </label>
      <div className="stock-unit-row wide-field">
        <span>Default stock</span>
        <input type="number" min="0" step="0.1" inputMode="decimal" value={form.keepStockQty ?? 0} onChange={(event) => update('keepStockQty', event.target.value)} placeholder="0.0 CTN" />
      </div>
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
