import { collection, getDocs } from 'firebase/firestore'
import { db } from '../src/firebase.js'
import fs from 'fs'

const run = async () => {
  const snapshot = await getDocs(collection(db, 'products'))
  const rows = snapshot.docs.map((d) => {
    const p = d.data()
    return {
      brand: p.brand || '',
      flavour: p.flavour || '',
      name: p.name || '',
      currentStock: p.currentStock ?? 0,
      keepStockQty: p.keepStockQty ?? 0,
      defaultBuyingPrice: p.defaultBuyingPrice ?? 0,
    }
  })

  rows.sort((a, b) => a.brand.localeCompare(b.brand) || a.flavour.localeCompare(b.flavour))

  const header = 'Brand,Flavour,Name,CurrentStock,DefaultStock,CostPrice\n'
  const body = rows
    .map((r) => `${r.brand},${r.flavour},${r.name},${r.currentStock},${r.keepStockQty},${r.defaultBuyingPrice}`)
    .join('\n')

  fs.writeFileSync('products-export.csv', header + body)
  console.log(`Exported ${rows.length} products to products-export.csv`)
}

run().catch((err) => {
  console.error('Failed:', err)
  process.exit(1)
})
