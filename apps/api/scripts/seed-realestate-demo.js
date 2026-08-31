#!/usr/bin/env node
/**
 * Seed a standalone real-estate demo tenant.
 *
 * Idempotent: updates only slug/email records owned by this demo.
 * Run from repo root or apps/api:
 *   node apps/api/scripts/seed-realestate-demo.js
 */
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '../.env.production') })
require('dotenv').config({ path: path.resolve(__dirname, '../.env') })
require('dotenv').config()

const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')
const db = require('@ayka/db')
const { encrypt } = require('../src/utils/encryption')

const { Business, KnowledgeBase, Reseller, User } = db
const Property = db.Property || mongoose.models.Property || mongoose.model('Property', new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  resellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Reseller', required: true, index: true },
  title: { type: String, required: true, trim: true },
  slug: { type: String, required: true, trim: true },
  status: { type: String, enum: ['available', 'hold', 'sold', 'rented', 'inactive'], default: 'available', index: true },
  listingType: { type: String, enum: ['sale', 'rent', 'lease'], default: 'sale' },
  propertyType: { type: String, enum: ['apartment', 'villa', 'plot', 'floor', 'commercial', 'office', 'shop', 'farmhouse', 'other'], default: 'apartment' },
  bhk: { type: String, default: '' },
  builtUpArea: { type: Number, default: 0 },
  carpetArea: { type: Number, default: 0 },
  areaUnit: { type: String, default: 'sqft' },
  price: { type: Number, default: 0 },
  priceLabel: { type: String, default: '' },
  maintenance: { type: Number, default: 0 },
  negotiable: { type: Boolean, default: false },
  location: {
    city: { type: String, default: '' },
    locality: { type: String, default: '' },
    address: { type: String, default: '' },
    landmark: { type: String, default: '' },
    mapUrl: { type: String, default: '' },
  },
  possession: { type: String, default: '' },
  furnishing: { type: String, enum: ['', 'unfurnished', 'semi-furnished', 'fully-furnished'], default: '' },
  facing: { type: String, default: '' },
  floor: { type: String, default: '' },
  amenities: [{ type: String, trim: true }],
  highlights: [{ type: String, trim: true }],
  description: { type: String, default: '' },
  media: [{
    type: { type: String, enum: ['image', 'video'], default: 'image' },
    url: { type: String, required: true },
    caption: { type: String, default: '' },
  }],
  contactPhone: { type: String, default: '' },
  isFeatured: { type: Boolean, default: false },
  priority: { type: Number, default: 0 },
}, { timestamps: true }))

const ADMIN_EMAIL = process.env.RE_DEMO_ADMIN_EMAIL || 'admin@ayka-realty-demo.in'
const ADMIN_PASSWORD = process.env.RE_DEMO_ADMIN_PASSWORD || 'AykaRealtyDemo2026!'
const BUSINESS_SLUG = 'ayka-realty-demo'
const DEFAULT_WA_PHONE_NUMBER_ID = '921089374430357'
const DEFAULT_WA_WABA_ID = '1995830367697152'
const DEFAULT_WA_VERIFY_TOKEN = 'ayka_realestate_demo_verify_2026'

const demoProperties = [
  {
    slug: 'skyline-heights-3bhk-gomti-nagar',
    title: 'Skyline Heights 3 BHK - Gomti Nagar Extension',
    status: 'available',
    listingType: 'sale',
    propertyType: 'apartment',
    bhk: '3 BHK',
    builtUpArea: 1680,
    carpetArea: 1285,
    areaUnit: 'sqft',
    price: 11800000,
    priceLabel: '₹1.18 Cr',
    negotiable: true,
    location: {
      city: 'Lucknow',
      locality: 'Gomti Nagar Extension',
      address: 'Near Shaheed Path, Gomti Nagar Extension, Lucknow',
      landmark: '5 min from Lulu Mall',
      mapUrl: 'https://maps.google.com/?q=Gomti+Nagar+Extension+Lucknow',
    },
    possession: 'Ready to move',
    furnishing: 'semi-furnished',
    facing: 'East facing',
    floor: '9th of 17',
    amenities: ['Clubhouse', 'Swimming pool', 'Gym', 'Covered parking', 'Power backup', '24x7 security'],
    highlights: ['Ready registry', 'Park-facing balcony', 'Loan approved project'],
    description: 'Premium ready-to-move apartment suited for family self-use near Shaheed Path and major schools.',
    media: [
      { type: 'image', url: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c', caption: 'Living room sample view' },
      { type: 'image', url: 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c', caption: 'Bedroom sample view' },
    ],
    contactPhone: '+919999900001',
    isFeatured: true,
    priority: 100,
  },
  {
    slug: 'green-villas-4bhk-sushant-golf-city',
    title: 'Green Villas 4 BHK - Sushant Golf City',
    status: 'available',
    listingType: 'sale',
    propertyType: 'villa',
    bhk: '4 BHK',
    builtUpArea: 3100,
    carpetArea: 2450,
    areaUnit: 'sqft',
    price: 24500000,
    priceLabel: '₹2.45 Cr',
    negotiable: true,
    location: {
      city: 'Lucknow',
      locality: 'Sushant Golf City',
      address: 'Sector C, Sushant Golf City, Lucknow',
      landmark: 'Near Ekana Stadium',
      mapUrl: 'https://maps.google.com/?q=Sushant+Golf+City+Lucknow',
    },
    possession: 'Ready to move',
    furnishing: 'fully-furnished',
    facing: 'North-East facing',
    floor: 'Ground + 2',
    amenities: ['Private lawn', 'Modular kitchen', 'Servant room', '2 covered parkings', 'Gated security'],
    highlights: ['Corner villa', 'Premium gated community', 'Ideal for self-use'],
    description: 'Large furnished villa for buyers looking for premium lifestyle and privacy.',
    media: [
      { type: 'image', url: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9', caption: 'Villa exterior sample' },
      { type: 'image', url: 'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3', caption: 'Dining and living sample' },
    ],
    contactPhone: '+919999900001',
    isFeatured: true,
    priority: 90,
  },
  {
    slug: 'plot-faizabad-road-1800-sqft',
    title: 'Registry Plot - Faizabad Road',
    status: 'available',
    listingType: 'sale',
    propertyType: 'plot',
    bhk: '1800 sqft plot',
    builtUpArea: 1800,
    areaUnit: 'sqft',
    price: 5400000,
    priceLabel: '₹54 L',
    negotiable: false,
    location: {
      city: 'Lucknow',
      locality: 'Faizabad Road',
      address: 'Near BBD University, Faizabad Road, Lucknow',
      landmark: 'Close to main highway',
      mapUrl: 'https://maps.google.com/?q=Faizabad+Road+Lucknow',
    },
    possession: 'Immediate registry',
    furnishing: '',
    facing: 'West facing',
    floor: '',
    amenities: ['Gated plotting', '30 ft road', 'Electricity poles', 'Drainage line'],
    highlights: ['Registry available', 'Good investment belt', 'Clear approach road'],
    description: 'Affordable residential plot for investment or independent house construction.',
    media: [
      { type: 'image', url: 'https://images.unsplash.com/photo-1500382017468-9049fed747ef', caption: 'Plot sample view' },
    ],
    contactPhone: '+919999900001',
    isFeatured: false,
    priority: 80,
  },
  {
    slug: '2bhk-rent-indira-nagar',
    title: '2 BHK for Rent - Indira Nagar',
    status: 'available',
    listingType: 'rent',
    propertyType: 'apartment',
    bhk: '2 BHK',
    builtUpArea: 980,
    areaUnit: 'sqft',
    price: 22000,
    priceLabel: '₹22,000/month',
    maintenance: 2500,
    negotiable: true,
    location: {
      city: 'Lucknow',
      locality: 'Indira Nagar',
      address: 'Bhootnath Market side, Indira Nagar, Lucknow',
      landmark: 'Walking distance from metro',
      mapUrl: 'https://maps.google.com/?q=Indira+Nagar+Lucknow',
    },
    possession: 'Immediate',
    furnishing: 'semi-furnished',
    facing: 'South facing',
    floor: '4th of 8',
    amenities: ['Lift', 'Parking', 'Security', 'Metro nearby'],
    highlights: ['Family preferred', 'Metro connectivity', 'Market nearby'],
    description: 'Clean rental flat for families or working professionals who need metro access.',
    media: [
      { type: 'image', url: 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267', caption: 'Rental flat sample' },
    ],
    contactPhone: '+919999900001',
    isFeatured: false,
    priority: 70,
  },
  {
    slug: 'commercial-shop-aliganj',
    title: 'Main Road Shop - Aliganj',
    status: 'available',
    listingType: 'rent',
    propertyType: 'shop',
    bhk: '420 sqft shop',
    builtUpArea: 420,
    areaUnit: 'sqft',
    price: 65000,
    priceLabel: '₹65,000/month',
    maintenance: 0,
    negotiable: true,
    location: {
      city: 'Lucknow',
      locality: 'Aliganj',
      address: 'Kapoorthala main road, Aliganj, Lucknow',
      landmark: 'High-footfall market',
      mapUrl: 'https://maps.google.com/?q=Kapoorthala+Aliganj+Lucknow',
    },
    possession: 'Immediate',
    furnishing: 'unfurnished',
    facing: 'Road facing',
    floor: 'Ground floor',
    amenities: ['Main road frontage', 'Shutter', 'Separate meter', 'Signage space'],
    highlights: ['High visibility', 'Good for retail/clinic', 'Ground floor'],
    description: 'Commercial shop for retail, clinic, office front, or franchise use.',
    media: [
      { type: 'image', url: 'https://images.unsplash.com/photo-1604014237800-1c9102c219da', caption: 'Commercial space sample' },
    ],
    contactPhone: '+919999900001',
    isFeatured: false,
    priority: 65,
  },
  {
    slug: 'office-space-vibhuti-khand',
    title: 'Furnished Office - Vibhuti Khand',
    status: 'available',
    listingType: 'lease',
    propertyType: 'office',
    bhk: '18-seat office',
    builtUpArea: 1450,
    areaUnit: 'sqft',
    price: 95000,
    priceLabel: '₹95,000/month',
    maintenance: 8000,
    negotiable: true,
    location: {
      city: 'Lucknow',
      locality: 'Vibhuti Khand',
      address: 'Vibhuti Khand, Gomti Nagar, Lucknow',
      landmark: 'Near High Court',
      mapUrl: 'https://maps.google.com/?q=Vibhuti+Khand+Lucknow',
    },
    possession: 'Within 7 days',
    furnishing: 'fully-furnished',
    facing: '',
    floor: '6th floor',
    amenities: ['Workstations', 'Cabin', 'Conference room', 'Pantry', 'Reception', 'Power backup'],
    highlights: ['Plug-and-play office', 'Corporate location', 'High Court nearby'],
    description: 'Ready furnished office for startups, consultants, and branch offices.',
    media: [
      { type: 'image', url: 'https://images.unsplash.com/photo-1497366754035-f200968a6e72', caption: 'Office space sample' },
    ],
    contactPhone: '+919999900001',
    isFeatured: false,
    priority: 60,
  },
]

async function ensureReseller() {
  let reseller = await Reseller.findOne({ slug: 'welltechup' })
  if (reseller) return reseller

  reseller = await Reseller.create({
    name: 'WellTechUp',
    slug: 'welltechup',
    email: 'admin@welltechup.com',
    phone: '+919876543210',
    platformFeeStatus: 'paid',
    themeConfig: {
      brandName: 'WellTechUp',
      primaryColor: '#0ea5e9',
      accentColor: '#38bdf8',
      backgroundColor: '#f0f9ff',
      sidebarColor: '#ffffff',
      textColor: '#0f172a',
      showPlatformCredit: true,
    },
    isActive: true,
  })
  return reseller
}

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is required')
    process.exit(1)
  }

  await mongoose.connect(process.env.MONGODB_URI)
  console.log('Connected to MongoDB')

  const reseller = await ensureReseller()
  const encryptedToken = encrypt(process.env.RE_DEMO_WA_ACCESS_TOKEN || 'demo_realestate_placeholder_access_token')

  const business = await Business.findOneAndUpdate(
    { slug: BUSINESS_SLUG },
    {
      $set: {
        resellerId: reseller._id,
        name: 'AyKa Realty Demo',
        slug: BUSINESS_SLUG,
        vertical: 'realestate',
        pricing: {
          totalPrice: 0,
          note: 'Demo real-estate tenant',
        },
        whatsapp: {
          phoneNumberId: process.env.RE_DEMO_WA_PHONE_NUMBER_ID || DEFAULT_WA_PHONE_NUMBER_ID,
          accessToken: encryptedToken,
          wabaId: process.env.RE_DEMO_WA_WABA_ID || DEFAULT_WA_WABA_ID,
          verifyToken: process.env.RE_DEMO_WA_VERIFY_TOKEN || DEFAULT_WA_VERIFY_TOKEN,
        },
        settings: {
          displayName: 'AyKa Realty Demo',
          agentName: 'Ria',
          timezone: 'Asia/Kolkata',
          language: 'en',
          handoffPhone: process.env.RE_DEMO_HANDOFF_PHONE || '+919999900001',
          dashboardHandoffReplyEnabled: true,
          allowPaidReplies: false,
        },
        widget: {
          enabled: true,
          position: 'bottom-right',
          welcomeMessage: 'Hi, looking for a flat, plot, villa, or commercial space?',
          placeholder: 'Tell us your budget and preferred location...',
          agentName: 'Ria',
          brandName: 'AyKa Realty Demo',
          theme: {
            primaryColor: '#0f766e',
            headerBg: '#111827',
            headerText: '#ffffff',
            chatBg: '#f8fafc',
            userBubble: '#0f766e',
            userText: '#ffffff',
            botBubble: '#ffffff',
            botText: '#111827',
          },
          collectName: true,
          collectEmail: false,
          collectPhone: true,
          poweredBy: true,
        },
        subscription: { plan: 'demo', status: 'active' },
        isActive: true,
      },
    },
    { new: true, upsert: true },
  )
  console.log(`Business ready: ${business.name} (${business._id})`)

  await KnowledgeBase.findOneAndUpdate(
    { businessId: business._id },
    {
      $set: {
        resellerId: reseller._id,
        vertical: 'realestate',
        isActive: true,
        version: 1,
        content: {
          about: {
            name: 'AyKa Realty Demo',
            address: 'Demo Sales Office, Gomti Nagar, Lucknow',
            phone: '+919999900001',
            website: 'https://ayka.site',
          },
          serviceAreas: ['Gomti Nagar', 'Sushant Golf City', 'Faizabad Road', 'Indira Nagar', 'Aliganj', 'Vibhuti Khand'],
          handoff: {
            staffPhone: process.env.RE_DEMO_HANDOFF_PHONE || '+919999900001',
            workingHours: '10 AM - 7 PM, all days',
          },
          financing: {
            summary: 'Home-loan assistance is available for eligible ready and approved projects. Exact bank approval is confirmed by the sales team.',
          },
          legal: {
            summary: 'Registry, title-chain, RERA, and due-diligence details are confirmed property-wise by the sales team before token/payment.',
          },
        },
      },
    },
    { upsert: true, new: true },
  )
  console.log('Knowledge base ready')

  for (const p of demoProperties) {
    await Property.findOneAndUpdate(
      { businessId: business._id, slug: p.slug },
      {
        $set: {
          ...p,
          businessId: business._id,
          resellerId: reseller._id,
        },
      },
      { upsert: true, new: true, runValidators: true },
    )
  }
  const propertyCount = await Property.countDocuments({ businessId: business._id, status: { $ne: 'inactive' } })
  console.log(`Properties ready: ${propertyCount}`)

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12)
  await User.findOneAndUpdate(
    { email: ADMIN_EMAIL.toLowerCase() },
    {
      $set: {
        email: ADMIN_EMAIL.toLowerCase(),
        passwordHash,
        role: 'client',
        businessId: business._id,
        resellerId: reseller._id,
        displayName: 'AyKa Realty Demo Admin',
        themeConfig: {
          brandName: 'AyKa Realty',
          logoUrl: null,
          primaryColor: '#0f766e',
          accentColor: '#14b8a6',
          backgroundColor: '#f8fafc',
          sidebarColor: '#ffffff',
          textColor: '#0f172a',
          faviconUrl: null,
          supportEmail: 'demo@ayka.site',
          supportPhone: '+919999900001',
          showPlatformCredit: true,
          features: {
            showAppointments: true,
            showAnalytics: true,
            showExport: true,
            showLeadScore: true,
            showConversations: true,
            showActivityFeed: true,
            showStaffNotifications: true,
            showBotStatus: true,
          },
        },
        isActive: true,
      },
    },
    { upsert: true, new: true },
  )

  console.log('\nREAL ESTATE DEMO LOGIN')
  console.log(`Email:    ${ADMIN_EMAIL}`)
  console.log(`Password: ${ADMIN_PASSWORD}`)
  console.log(`Business: ${business._id}`)
  console.log(`Widget businessId: ${business._id}`)

  await mongoose.disconnect()
}

main().catch(async (err) => {
  console.error(err)
  try {
    await mongoose.disconnect()
  } catch {
    // no-op
  }
  process.exit(1)
})
