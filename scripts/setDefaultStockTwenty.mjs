import { collection, getDocs, writeBatch, doc } from 'firebase/firestore'
import { db } from '../src/firebase.js'

const BATCH_LIMIT = 450

const run = async () => {
  const snapshot = await getDocs(collection(db, 'products'))
  const docs = snapshot.docs

  for (let i = 0; i < docs.length; i += BATCH_LIMIT) {
    const chunk = docs.slice(i, i + BATCH_LIMIT)
    const batch = writeBatch(db)
    chunk.forEach((productDoc) => {
      batch.set(doc(db, 'products', productDoc.id), { keepStockQty: 20 }, { merge: true })
    })
    await batch.commit()
    console.log(`Updated ${chunk.length} products (batch ${Math.floor(i / BATCH_LIMIT) + 1}).`)
  }

  console.log(`Done. Total updated: ${docs.length}`)
}

run().then(() => process.exit(0)).catch((err) => {
  console.error('Failed:', err)
  process.exit(1)
})
