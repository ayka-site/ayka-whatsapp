const mongoose = require('mongoose')
const { Schema } = mongoose

const mediaSchema = new Schema({
  type: { type: String, enum: ['image', 'video'], default: 'image' },
  url: { type: String, required: true },
  caption: { type: String, default: '' },
}, { _id: false })

const propertySchema = new Schema({
  businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
  resellerId: { type: Schema.Types.ObjectId, ref: 'Reseller', default: null },

  title: { type: String, required: true, trim: true },
  slug: { type: String, trim: true },
  status: {
    type: String,
    enum: ['available', 'hold', 'sold', 'rented', 'inactive'],
    default: 'available',
  },
  listingType: {
    type: String,
    enum: ['sale', 'rent', 'lease'],
    default: 'sale',
  },
  propertyType: {
    type: String,
    enum: ['apartment', 'villa', 'plot', 'floor', 'commercial', 'office', 'shop', 'farmhouse', 'other'],
    default: 'apartment',
  },
  bhk: { type: String, default: '' },
  carpetArea: { type: Number, default: null },
  builtUpArea: { type: Number, default: null },
  areaUnit: { type: String, enum: ['sqft', 'sqyd', 'sqm', 'acre', 'bigha'], default: 'sqft' },

  price: { type: Number, default: null },
  priceLabel: { type: String, default: '' },
  maintenance: { type: Number, default: null },
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
  amenities: { type: [String], default: [] },
  highlights: { type: [String], default: [] },
  description: { type: String, default: '' },
  media: { type: [mediaSchema], default: [] },
  contactPhone: { type: String, default: '' },
  isFeatured: { type: Boolean, default: false },
  priority: { type: Number, default: 0 },
}, { timestamps: true })

propertySchema.index({ businessId: 1, status: 1, priority: -1, updatedAt: -1 })
propertySchema.index({ businessId: 1, location: 1 })
propertySchema.index({ businessId: 1, propertyType: 1, listingType: 1 })

module.exports = mongoose.model('Property', propertySchema)
