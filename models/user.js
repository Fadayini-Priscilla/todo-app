const mongoose = require('mongoose');
const bcrypt = require('bcryptjs'); // For password hashing

const UserSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true,
        trim: true // Remove whitespace from both ends of a string
    },
    password: { // Will store hashed password
        type: String,
        required: true
    },
    email: { // Added for uniqueness and good practice, though prompt only mentioned username/password
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true // Store emails in lowercase for consistent lookups
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

// Pre-save hook to hash password before saving a new user
UserSchema.pre('save', async function (next) {
    if (this.isModified('password')) { // Only hash if the password has been modified (or is new)
        this.password = await bcrypt.hash(this.password, 10); // Hash with a salt round of 10
    }
    this.updatedAt = Date.now(); // Update updatedAt timestamp on every save
    next();
});

// Method to compare candidate password with hashed password in the database
UserSchema.methods.comparePassword = async function (candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', UserSchema);
