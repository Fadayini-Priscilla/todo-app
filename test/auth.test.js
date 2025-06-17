process.env.NODE_ENV = 'test'; // Ensure test environment is loaded

const request = require('supertest'); // Supertest for HTTP requests
const { app, server, mongoose } = require('../app'); // Import app, server, mongoose
const User = require('../models/user'); // User model for direct db interaction

describe('Authentication API Tests', () => {
    // Before all tests, clear the User collection
    beforeAll(async () => {
        await User.deleteMany({});
        console.log('Cleared Users collection before auth tests.');
    });

    // After all tests, close the server and mongoose connection
    afterAll(async () => {
        // Robustly close the server only if it's a valid HTTP server instance
        if (server && typeof server.close === 'function') {
            await new Promise(resolve => server.close(resolve));
            console.log('Auth test server closed.');
        } else {
            console.warn('Server instance not available or .close method not found for Auth tests.');
        }

        // Disconnect Mongoose only if connected
        if (mongoose.connection.readyState === 1) { // Check if connected
            await mongoose.disconnect();
            console.log('Auth test MongoDB disconnected.');
        } else {
            console.warn('Mongoose connection not active for Auth tests.');
        }
    });

    describe('POST /register', () => {
        test('should register a new user successfully', async () => {
            const res = await request(app)
                .post('/register')
                .send({
                    username: 'testuser1',
                    email: 'testuser1@example.com',
                    password: 'password123',
                    password2: 'password123'
                });
            expect(res.statusCode).toBe(302); // Redirect status
            expect(res.headers.location).toBe('/login'); // Redirects to login
        });

        test('should not register with existing username', async () => {
            const res = await request(app)
                .post('/register')
                .send({
                    username: 'testuser1', // Duplicate
                    email: 'another@example.com',
                    password: 'password123',
                    password2: 'password123'
                });
            expect(res.statusCode).toBe(302);
            expect(res.headers.location).toBe('/register'); // Redirects back to register
        });

        test('should not register with existing email', async () => {
            const res = await request(app)
                .post('/register')
                .send({
                    username: 'testuser2',
                    email: 'testuser1@example.com', // Duplicate
                    password: 'password123',
                    password2: 'password123'
                });
            expect(res.statusCode).toBe(302);
            expect(res.headers.location).toBe('/register');
        });

        test('should not register with mismatching passwords', async () => {
            const res = await request(app)
                .post('/register')
                .send({
                    username: 'testuser3',
                    email: 'testuser3@example.com',
                    password: 'password123',
                    password2: 'wrongpassword'
                });
            expect(res.statusCode).toBe(302);
            expect(res.headers.location).toBe('/register');
        });

        test('should not register with password less than 6 characters', async () => {
            const res = await request(app)
                .post('/register')
                .send({
                    username: 'testuser4',
                    email: 'testuser4@example.com',
                    password: 'pass',
                    password2: 'pass'
                });
            expect(res.statusCode).toBe(302);
            expect(res.headers.location).toBe('/register');
        });
    });

    describe('POST /login', () => {
        // Register a user first for login tests
        beforeAll(async () => {
            await User.deleteMany({}); // Ensure clean state
            // Hash password manually before creating user as pre-save hook isn't run for direct create in some test scenarios
            // No, the pre-save hook *will* run if you use User.create().
            await User.create({
                username: 'loginuser',
                email: 'login@example.com',
                password: 'loginpassword'
            });
        });

        test('should login a registered user successfully', async () => {
            const res = await request(app)
                .post('/login')
                .send({
                    username: 'loginuser',
                    password: 'loginpassword'
                });
            expect(res.statusCode).toBe(302); // Redirect status
            expect(res.headers.location).toBe('/dashboard'); // Redirects to dashboard
            expect(res.headers['set-cookie']).toBeDefined(); // Check for session cookie
        });

        test('should not login with incorrect password', async () => {
            const res = await request(app)
                .post('/login')
                .send({
                    username: 'loginuser',
                    password: 'wrongpassword'
                });
            expect(res.statusCode).toBe(302);
            expect(res.headers.location).toBe('/login');
        });

        test('should not login with unregistered username', async () => {
            const res = await request(app)
                .post('/login')
                .send({
                    username: 'nonexistentuser',
                    password: 'anypassword'
                });
            expect(res.statusCode).toBe(302);
            expect(res.headers.location).toBe('/login');
        });
    });
});
