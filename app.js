// At the very top of your Todo App's main server file app.js
require('dotenv').config();

// You can add these temporary logs to verify if it's working:
console.log('Todo App MONGO_URI:', process.env.MONGO_URI);
console.log('Todo App SESSION_SECRET:', process.env.SESSION_SECRET);

const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy; // Required for passport.use directly
const flash = require('connect-flash');

// Load Passport config
const configurePassport = require('./config/passport');
configurePassport(passport); // Pass passport instance to config function

const User = require('./models/user'); // User model for routes
const Task = require('./models/task'); // Task model for routes

const app = express();
const PORT = process.env.PORT || 8000; // Use process.env.PORT for dynamic assignment in tests
const mongoURI = process.env.MONGO_URI;
const sessionSecret = process.env.SESSION_SECRET;

// --- MongoDB Connection ---
mongoose.connect(mongoURI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log(`MongoDB Connected to: ${mongoURI}`))
.catch(err => console.error('MongoDB connection error:', err));

// --- EJS Setup ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- Express Session Middleware ---
app.use(session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false
}));

// --- Passport Middleware ---
app.use(passport.initialize());
app.use(passport.session());

// --- Connect Flash Middleware (for transient messages) ---
app.use(flash());

// --- Global Variables for Flash Messages ---
app.use((req, res, next) => {
    res.locals.success_msg = req.flash('success_msg');
    res.locals.error_msg = req.flash('error_msg');
    res.locals.error = req.flash('error');
    res.locals.user = req.user || null;
    next();
});

// --- Body Parser Middleware (for parsing form data) ---
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// --- Static Files ---
app.use(express.static(path.join(__dirname, 'public')));

// --- Authentication Middleware for Protected Routes ---
function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    req.flash('error_msg', 'Please log in to view this resource');
    res.redirect('/login');
}

// --- Routes ---

// Welcome/Root Route
app.get('/', (req, res) => {
    res.render('login', { title: 'Welcome' });
});

// Login Page
app.get('/login', (req, res) => {
    res.render('login', { title: 'Login' });
});

// Login Handle
app.post('/login', (req, res, next) => {
    passport.authenticate('local', {
        successRedirect: '/dashboard',
        failureRedirect: '/login',
        failureFlash: true
    })(req, res, next);
});

// Register Page
app.get('/register', (req, res) => {
    res.render('register', { title: 'Register' });
});

// Register Handle
app.post('/register', async (req, res) => {
    const { username, email, password, password2 } = req.body;
    let errors = [];

    // Check required fields
    if (!username || !email || !password || !password2) {
        errors.push({ msg: 'Please enter all fields' });
    }
    // Check passwords match
    if (password !== password2) {
        errors.push({ msg: 'Passwords do not match' });
    }
    // Check password length
    if (password.length < 6) {
        errors.push({ msg: 'Password must be at least 6 characters' });
    }

    if (errors.length > 0) {
        // Set flash messages for all collected errors
        errors.forEach(err => req.flash('error_msg', err.msg));
        res.redirect('/register'); // Redirect back to register page
    } else {
        // Validation passed (no basic errors)
        try {
            // Check if user already exists in DB
            const userExists = await User.findOne({ $or: [{ username: username }, { email: email }] });
            if (userExists) {
                req.flash('error_msg', 'Username or Email already registered');
                return res.redirect('/register'); // Redirect for duplicate error
            }

            const newUser = new User({
                username,
                email,
                password // Password hashing is done in the pre-save hook in user.js
            });

            await newUser.save();
            req.flash('success_msg', 'You are now registered and can log in');
            res.redirect('/login'); // Redirect to login on successful registration

        } catch (err) {
            console.error('Registration error (DB or Mongoose):', err); // Log the full error for debugging

            // Check for MongoDB duplicate key error (code 11000)
            if (err.code === 11000) {
                const field = Object.keys(err.keyValue)[0];
                req.flash('error_msg', `${field.charAt(0).toUpperCase() + field.slice(1)} already exists. Please choose a different ${field}.`);
            } else if (err.name === 'ValidationError') {
                const errorMessages = Object.values(err.errors).map(e => e.message);
                req.flash('error_msg', `Validation failed: ${errorMessages.join(', ')}`);
            } else {
                req.flash('error_msg', 'Server error during registration. Please try again.');
            }
            res.redirect('/register'); // Redirect for other server-side errors
        }
    }
});

// Logout Handle
app.get('/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) { return next(err); }
        req.flash('success_msg', 'You are logged out');
        res.redirect('/login');
    });
});

// Dashboard Route (Protected)
app.get('/dashboard', ensureAuthenticated, async (req, res) => {
    try {
        let tasksQuery = { userId: req.user.id };

        // Filter based on query parameter 'status'
        const filterStatus = req.query.status;
        if (filterStatus && filterStatus !== 'all' && ['pending', 'completed', 'deleted'].includes(filterStatus)) {
            tasksQuery.status = filterStatus;
        }

        let tasks = await Task.find(tasksQuery).sort({ createdAt: -1 });

        res.render('dashboard', {
            title: 'Dashboard',
            user: req.user,
            tasks,
            filterStatus: filterStatus || 'all'
        });
    } catch (err) {
        console.error('Error fetching tasks for dashboard:', err);
        req.flash('error_msg', 'Could not load tasks.');
        res.redirect('/login'); // Redirect to login if dashboard fails due to data issues or auth
    }
});

// Create Task Handle (Protected)
app.post('/tasks', ensureAuthenticated, async (req, res) => {
    const { title, description } = req.body;
    if (!title) {
        req.flash('error_msg', 'Task title is required.');
        return res.redirect('/dashboard');
    }

    try {
        const newTask = new Task({
            title,
            description,
            userId: req.user.id
        });
        await newTask.save();
        req.flash('success_msg', 'Task added successfully!');
        res.redirect('/dashboard');
    } catch (err) {
        console.error('Error creating task:', err);
        req.flash('error_msg', 'Failed to add task.');
        res.redirect('/dashboard');
    }
});

// Update Task Status Handle (Protected)
app.post('/tasks/update-status/:id', ensureAuthenticated, async (req, res) => {
    const taskId = req.params.id;
    const { newStatus } = req.body;

    if (!['completed', 'deleted', 'pending'].includes(newStatus)) {
        req.flash('error_msg', 'Invalid status provided.');
        return res.redirect('/dashboard');
    }

    try {
        const task = await Task.findOne({ _id: taskId, userId: req.user.id });

        if (!task) {
            req.flash('error_msg', 'Task not found or you do not have permission.');
            return res.redirect('/dashboard');
        }

        task.status = newStatus;
        await task.save();
        req.flash('success_msg', `Task marked as ${newStatus}!`);
        res.redirect('/dashboard');
    } catch (err) {
        console.error('Error updating task status:', err);
        req.flash('error_msg', 'Failed to update task status.');
        res.redirect('/dashboard');
    }
});

// Delete Task Handle (Protected - Note: this physically deletes)
app.post('/tasks/delete/:id', ensureAuthenticated, async (req, res) => {
    const taskId = req.params.id;

    try {
        const result = await Task.deleteOne({ _id: taskId, userId: req.user.id });

        if (result.deletedCount === 0) {
            req.flash('error_msg', 'Task not found or you do not have permission.');
        } else {
            req.flash('success_msg', 'Task permanently deleted.');
        }
        res.redirect('/dashboard');
    } catch (err) {
        console.error('Error deleting task:', err);
        req.flash('error_msg', 'Failed to delete task.');
        res.redirect('/dashboard');
    }
});


// --- Error Handling (Global and Local) ---
// 404 Not Found
app.use((req, res, next) => {
    res.status(404).render('error', {
        title: '404 Not Found',
        message: 'The page you are looking for does not exist.'
    });
});

// Global Error Handler
app.use((err, req, res, next) => {
    console.error('Global Error Handler:', err.stack); // Log full stack trace
    req.flash('error_msg', 'An unexpected server error occurred.');
    res.status(500).render('error', {
        title: '500 Server Error',
        message: 'Something went wrong on our end. Please try again later.'
    });
});


// --- Start Server ---
// Store the server instance in a variable before exporting
let serverInstance;

// Assign the result of app.listen to serverInstance
serverInstance = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

// Export app, server instance, and mongoose for testing purposes
module.exports = { app, server: serverInstance, mongoose };

