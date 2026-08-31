'use client'
import { useState, useCallback } from 'react'
import DashboardLayout from '../../../components/DashboardLayout'
import { TopBar, Badge, DataTable, SlideOver, FormField, FormInput, FormSelect } from '../../../components/UI'
import { useFetch } from '../../../hooks/useFetch'
const { apiFetch, getUser, getToken, API_URL } = require('../../../lib/api')

const EMPTY_FORM = {
  title: '',
  status: 'available',
  listingType: 'sale',
  propertyType: 'apartment',
  bhk: '',
  builtUpArea: '',
  carpetArea: '',
  areaUnit: 'sqft',
  price: '',
  priceLabel: '',
  maintenance: '',
  negotiable: false,
  city: '',
  locality: '',
  address: '',
  landmark: '',
  mapUrl: '',
  possession: '',
  furnishing: '',
  facing: '',
  floor: '',
  amenities: '',
  highlights: '',
  description: '',
  contactPhone: '',
  isFeatured: false,
  priority: 0,
  media: [],
}

const propertyTypes = [
  ['apartment', 'Apartment / Flat'],
  ['villa', 'Villa / Independent House'],
  ['plot', 'Plot / Land'],
  ['floor', 'Builder Floor'],
  ['commercial', 'Commercial'],
  ['office', 'Office'],
  ['shop', 'Shop'],
  ['farmhouse', 'Farmhouse'],
  ['other', 'Other'],
].map(([value, label]) => ({ value, label }))

const listingTypes = ['sale', 'rent', 'lease'].map(v => ({ value: v, label: v.charAt(0).toUpperCase() + v.slice(1) }))
const statuses = ['available', 'hold', 'sold', 'rented', 'inactive'].map(v => ({ value: v, label: v.charAt(0).toUpperCase() + v.slice(1) }))
const furnishingOptions = [
  { value: '', label: 'Not specified' },
  { value: 'unfurnished', label: 'Unfurnished' },
  { value: 'semi-furnished', label: 'Semi-furnished' },
  { value: 'fully-furnished', label: 'Fully furnished' },
]

function formatPrice(row) {
  if (row.priceLabel) return row.priceLabel
  const n = Number(row.price)
  if (!Number.isFinite(n) || n <= 0) return 'Price on request'
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(n % 10000000 === 0 ? 0 : 2)} Cr`
  if (n >= 100000) return `₹${(n / 100000).toFixed(n % 100000 === 0 ? 0 : 1)} L`
  return `₹${n.toLocaleString('en-IN')}`
}

function propertyToForm(property) {
  if (!property) return EMPTY_FORM
  return {
    ...EMPTY_FORM,
    ...property,
    city: property.location?.city || '',
    locality: property.location?.locality || '',
    address: property.location?.address || '',
    landmark: property.location?.landmark || '',
    mapUrl: property.location?.mapUrl || '',
    amenities: (property.amenities || []).join(', '),
    highlights: (property.highlights || []).join(', '),
    media: property.media || [],
  }
}

function buildPayload(form) {
  return {
    title: form.title,
    status: form.status,
    listingType: form.listingType,
    propertyType: form.propertyType,
    bhk: form.bhk,
    builtUpArea: form.builtUpArea,
    carpetArea: form.carpetArea,
    areaUnit: form.areaUnit,
    price: form.price,
    priceLabel: form.priceLabel,
    maintenance: form.maintenance,
    negotiable: form.negotiable,
    location: {
      city: form.city,
      locality: form.locality,
      address: form.address,
      landmark: form.landmark,
      mapUrl: form.mapUrl,
    },
    possession: form.possession,
    furnishing: form.furnishing,
    facing: form.facing,
    floor: form.floor,
    amenities: form.amenities,
    highlights: form.highlights,
    description: form.description,
    contactPhone: form.contactPhone,
    isFeatured: form.isFeatured,
    priority: form.priority,
    media: form.media,
  }
}

export default function ClientProperties() {
  const user = getUser()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')
  const [status, setStatus] = useState('available,hold')
  const [form, setForm] = useState(EMPTY_FORM)
  const [editing, setEditing] = useState(null)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploadingMedia, setUploadingMedia] = useState(false)
  const [showMoreDetails, setShowMoreDetails] = useState(false)
  const [error, setError] = useState('')

  const handleSearch = useCallback((val) => {
    setSearch(val)
    clearTimeout(window.__propertySearchTimer)
    window.__propertySearchTimer = setTimeout(() => { setSearchDebounced(val); setPage(1) }, 300)
  }, [])

  const url = `/api/client/properties?page=${page}&limit=25${status ? `&status=${encodeURIComponent(status)}` : ''}${searchDebounced ? `&search=${encodeURIComponent(searchDebounced)}` : ''}`
  const { data, loading, refetch } = useFetch(url, [page, status, searchDebounced])

  function startCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setError('')
    setShowMoreDetails(false)
    setOpen(true)
  }

  function startEdit(row) {
    setEditing(row)
    setForm(propertyToForm(row))
    setError('')
    setShowMoreDetails(false)
    setOpen(true)
  }

  function setField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function uploadMedia(files) {
    const selected = Array.from(files || [])
    if (!selected.length) return

    setUploadingMedia(true)
    setError('')
    try {
      const body = new FormData()
      selected.forEach(file => body.append('media', file))

      const token = getToken()
      const headers = {}
      if (token) headers.Authorization = `Bearer ${token}`

      const res = await fetch(`${API_URL}/api/client/properties/media`, {
        method: 'POST',
        headers,
        body,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Upload failed: ${res.status}`)

      setForm(prev => ({ ...prev, media: [...(prev.media || []), ...(data.media || [])] }))
    } catch (err) {
      setError(err.message || 'Failed to upload media')
    } finally {
      setUploadingMedia(false)
    }
  }

  function removeMedia(index) {
    setForm(prev => ({ ...prev, media: (prev.media || []).filter((_, i) => i !== index) }))
  }

  async function saveProperty(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const payload = buildPayload(form)
      if (editing?._id) {
        await apiFetch(`/api/client/properties/${editing._id}`, { method: 'PATCH', body: JSON.stringify(payload) })
      } else {
        await apiFetch('/api/client/properties', { method: 'POST', body: JSON.stringify(payload) })
      }
      setOpen(false)
      await refetch()
    } catch (err) {
      setError(err.message || 'Failed to save property')
    } finally {
      setSaving(false)
    }
  }

  async function markInactive(row) {
    if (!confirm(`Mark "${row.title}" inactive?`)) return
    await apiFetch(`/api/client/properties/${row._id}`, { method: 'DELETE' })
    await refetch()
  }

  if (user?.businessVertical && user.businessVertical !== 'realestate') {
    return (
      <DashboardLayout requiredRole="client">
        <TopBar title="Properties" breadcrumbs={['Home', 'Properties']} />
        <div className="rounded-xl border border-white/10 p-8" style={{ background: 'var(--color-sidebar)', color: 'var(--color-text)' }}>
          Property inventory is available for real estate clients.
        </div>
      </DashboardLayout>
    )
  }

  const columns = [
    { key: 'title', label: 'Property', render: (v, row) => (
      <div>
        <p className="font-medium">{v}</p>
        <p className="text-xs opacity-50">{[row.bhk, row.propertyType, row.listingType].filter(Boolean).join(' · ')}</p>
      </div>
    )},
    { key: 'location', label: 'Location', render: (_, row) => [row.location?.locality, row.location?.city].filter(Boolean).join(', ') || '-' },
    { key: 'price', label: 'Price', render: (_, row) => <span>{formatPrice(row)}{row.negotiable ? <span className="opacity-50"> · nego</span> : null}</span> },
    { key: 'status', label: 'Status', render: v => <Badge score={v} /> },
    { key: 'media', label: 'Media', render: v => `${(v || []).filter(m => m.type === 'image').length} photos / ${(v || []).filter(m => m.type === 'video').length} videos` },
    { key: 'updatedAt', label: 'Updated', render: v => v ? new Date(v).toLocaleDateString('en-IN') : '-' },
    { key: 'actions', label: '', render: (_, row) => (
      <div className="flex gap-2">
        <button onClick={(e) => { e.stopPropagation(); startEdit(row) }} className="text-xs px-2 py-1 rounded border border-white/10">Edit</button>
        <button onClick={(e) => { e.stopPropagation(); markInactive(row) }} className="text-xs px-2 py-1 rounded border border-white/10 opacity-70">Inactive</button>
      </div>
    )},
  ]

  return (
    <DashboardLayout requiredRole="client">
      <TopBar
        title="Properties"
        breadcrumbs={['Home', 'Properties']}
        action={<button onClick={startCreate} className="px-4 py-2 text-sm rounded-lg text-white" style={{ background: 'var(--color-primary)' }}>Add Property</button>}
      />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <FormSelect
          value={status}
          onChange={(v) => { setStatus(v); setPage(1) }}
          options={[
            { value: '', label: 'All statuses' },
            { value: 'available,hold', label: 'Active inventory' },
            { value: 'available', label: 'Available only' },
            { value: 'hold', label: 'On hold' },
            { value: 'sold,rented,inactive', label: 'Closed/inactive' },
          ]}
        />
        <input
          value={search}
          onChange={e => handleSearch(e.target.value)}
          placeholder="Search property, locality, city…"
          className="px-3 py-2 text-sm rounded-lg border border-white/10 bg-transparent outline-none"
          style={{ color: 'var(--color-text)', minWidth: 260 }}
        />
      </div>

      <DataTable
        columns={columns}
        data={data?.properties}
        loading={loading}
        onRowClick={startEdit}
        page={page}
        totalPages={data?.totalPages}
        total={data?.total}
        limit={25}
        onPageChange={setPage}
        emptyMessage="No properties yet. Add active inventory so the bot can recommend it."
      />

      <SlideOver open={open} onClose={() => setOpen(false)} title={editing ? 'Edit Property' : 'Add Property'}>
        <form onSubmit={saveProperty} className="space-y-5">
          {error && <div className="text-sm text-red-400">{error}</div>}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FormField label="Title"><FormInput value={form.title} onChange={v => setField('title', v)} required placeholder="3 BHK near Gomti Nagar" /></FormField>
            <FormField label="Status"><FormSelect value={form.status} onChange={v => setField('status', v)} options={statuses} /></FormField>
            <FormField label="Listing"><FormSelect value={form.listingType} onChange={v => setField('listingType', v)} options={listingTypes} /></FormField>
            <FormField label="Type"><FormSelect value={form.propertyType} onChange={v => setField('propertyType', v)} options={propertyTypes} /></FormField>
            <FormField label="BHK / Size"><FormInput value={form.bhk} onChange={v => setField('bhk', v)} placeholder="2 BHK / 200 sq yd" /></FormField>
            <FormField label="Built-up Area"><FormInput type="number" value={form.builtUpArea} onChange={v => setField('builtUpArea', v)} placeholder="1200" /></FormField>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FormField label="Display Price"><FormInput value={form.priceLabel} onChange={v => setField('priceLabel', v)} placeholder="₹85 L / ₹28,000 rent" /></FormField>
            <FormField label="Price Number"><FormInput type="number" value={form.price} onChange={v => setField('price', v)} placeholder="8500000" /></FormField>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FormField label="City"><FormInput value={form.city} onChange={v => setField('city', v)} required /></FormField>
            <FormField label="Locality"><FormInput value={form.locality} onChange={v => setField('locality', v)} required /></FormField>
            <FormField label="Address"><FormInput value={form.address} onChange={v => setField('address', v)} /></FormField>
            <FormField label="Contact Phone"><FormInput value={form.contactPhone} onChange={v => setField('contactPhone', v)} /></FormField>
          </div>

          <FormField label="Description">
            <textarea value={form.description} onChange={e => setField('description', e.target.value)} rows={4}
              className="w-full px-3 py-2 text-sm rounded-lg border border-white/10 bg-transparent outline-none focus:border-white/30"
              style={{ color: 'var(--color-text)' }} />
          </FormField>

          <FormField label="Photos / Videos" hint="Upload JPG, PNG, WebP, GIF, MP4, WebM, or MOV. Max 50 MB per file.">
            <div className="space-y-3">
              <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-white/20 px-4 py-6 text-center hover:bg-white/5" style={{ color: 'var(--color-text)' }}>
                <input
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
                  className="hidden"
                  onChange={e => { uploadMedia(e.target.files); e.target.value = '' }}
                  disabled={uploadingMedia}
                />
                <span className="text-sm font-medium">{uploadingMedia ? 'Uploading...' : 'Click to upload photos or videos'}</span>
                <span className="mt-1 text-xs opacity-60">The bot will use these files when sharing property details.</span>
              </label>

              {(form.media || []).length > 0 && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {form.media.map((item, index) => (
                    <div key={`${item.url}-${index}`} className="rounded-lg border border-white/10 p-2" style={{ background: 'rgba(255,255,255,0.03)' }}>
                      {item.type === 'video' ? (
                        <div className="flex aspect-video items-center justify-center rounded bg-black/30 text-xs" style={{ color: 'var(--color-text)' }}>Video</div>
                      ) : (
                        <img src={item.url} alt={item.caption || 'Property media'} className="aspect-video w-full rounded object-cover" />
                      )}
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="truncate text-xs opacity-70" style={{ color: 'var(--color-text)' }}>{item.originalName || item.caption || item.url}</span>
                        <button type="button" onClick={() => removeMedia(index)} className="shrink-0 rounded border border-white/10 px-2 py-1 text-xs" style={{ color: 'var(--color-text)' }}>Remove</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </FormField>

          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
              <input type="checkbox" checked={form.negotiable} onChange={e => setField('negotiable', e.target.checked)} />
              Negotiable
            </label>
            <label className="flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
              <input type="checkbox" checked={form.isFeatured} onChange={e => setField('isFeatured', e.target.checked)} />
              Featured
            </label>
          </div>

          <button
            type="button"
            onClick={() => setShowMoreDetails(v => !v)}
            className="text-sm underline opacity-80 hover:opacity-100"
            style={{ color: 'var(--color-text)' }}
          >
            {showMoreDetails ? 'Hide more details' : 'Add more details'}
          </button>

          {showMoreDetails && (
            <div className="space-y-4 rounded-lg border border-white/10 p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <FormField label="Carpet Area"><FormInput type="number" value={form.carpetArea} onChange={v => setField('carpetArea', v)} /></FormField>
                <FormField label="Area Unit"><FormSelect value={form.areaUnit} onChange={v => setField('areaUnit', v)} options={['sqft', 'sqyd', 'sqm', 'acre', 'bigha'].map(x => ({ value: x, label: x }))} /></FormField>
                <FormField label="Maintenance"><FormInput type="number" value={form.maintenance} onChange={v => setField('maintenance', v)} /></FormField>
                <FormField label="Priority"><FormInput type="number" value={form.priority} onChange={v => setField('priority', v)} /></FormField>
                <FormField label="Landmark"><FormInput value={form.landmark} onChange={v => setField('landmark', v)} /></FormField>
                <FormField label="Map URL"><FormInput value={form.mapUrl} onChange={v => setField('mapUrl', v)} placeholder="https://maps.google.com/..." /></FormField>
                <FormField label="Possession"><FormInput value={form.possession} onChange={v => setField('possession', v)} placeholder="Ready to move / Dec 2026" /></FormField>
                <FormField label="Furnishing"><FormSelect value={form.furnishing} onChange={v => setField('furnishing', v)} options={furnishingOptions} /></FormField>
                <FormField label="Facing"><FormInput value={form.facing} onChange={v => setField('facing', v)} placeholder="East facing" /></FormField>
                <FormField label="Floor"><FormInput value={form.floor} onChange={v => setField('floor', v)} placeholder="7th of 14" /></FormField>
              </div>
              <FormField label="Amenities" hint="Comma separated"><FormInput value={form.amenities} onChange={v => setField('amenities', v)} placeholder="Lift, parking, security, clubhouse" /></FormField>
              <FormField label="Highlights" hint="Comma separated"><FormInput value={form.highlights} onChange={v => setField('highlights', v)} placeholder="Near metro, corner plot, park facing" /></FormField>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-3">
            <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-sm rounded-lg border border-white/10" style={{ color: 'var(--color-text)' }}>Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 text-sm rounded-lg text-white disabled:opacity-50" style={{ background: 'var(--color-primary)' }}>
              {saving ? 'Saving…' : 'Save Property'}
            </button>
          </div>
        </form>
      </SlideOver>
    </DashboardLayout>
  )
}
