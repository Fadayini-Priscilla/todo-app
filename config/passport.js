const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs');
const User = require('../models/user'); // Path to your User model

module.exports = function (passport) {
    // Local Strategy for username/password login
    passport.use(
        new LocalStrategy({ usernameField: 'username' }, async (username, password, done) => {
            try {
                // Find user by username
                const user = await User.findOne({ username: username });

                if (!user) {
                    return done(null, false, { message: 'That username is not registered' });
                }

                // Match password
                const isMatch = await user.comparePassword(password); // Using the comparePassword method defined in UserSchema

                if (isMatch) {
                    return done(null, user); // Authentication successful
                } else {
                    return done(null, false, { message: 'Password incorrect' });
                }
            } catch (err) {
                return done(err); // Server error
            }
        })
    );

    // Serialize user: Store user ID in session
    passport.serializeUser((user, done) => {
        done(null, user.id);
    });

    // Deserialize user: Retrieve user from database using ID stored in session
    passport.deserializeUser(async (id, done) => {
        try {
            const user = await User.findById(id);
            done(null, user);
        } catch (err) {
            done(err, null);
        }
    });
};
