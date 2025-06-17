process.env.NODE_ENV = 'test'; // Ensure test environment is loaded

const request = require('supertest'); // Supertest for HTTP requests
const { app, server, mongoose } = require('../app'); // Import app, server, mongoose
const User = require('../models/user');
const Task = require('../models/task');

describe('Task Management API Tests', () => {
    let agent; // Will store the authenticated Supertest agent for chaining requests
    let testUserId;

    // Before all tests, set up a test user and obtain an authenticated agent
    beforeAll(async () => {
        // Clear both collections
        await User.deleteMany({});
        await Task.deleteMany({});
        console.log('Cleared Users and Tasks collections before task tests.');

        // 1. Register a user
        await request(app)
            .post('/register')
            .send({
                username: 'taskuser',
                email: 'task@example.com',
                password: 'taskpassword123',
                password2: 'taskpassword123'
            });

        // 2. Login the user and obtain an authenticated agent
        agent = request.agent(app); // Create an agent to persist session
        const loginRes = await agent
            .post('/login')
            .send({
                username: 'taskuser',
                password: 'taskpassword123'
            });

        expect(loginRes.statusCode).toBe(302);
        expect(loginRes.headers.location).toBe('/dashboard');
        expect(loginRes.headers['set-cookie']).toBeDefined();

        // Get the user ID from the database after registration
        const user = await User.findOne({ username: 'taskuser' });
        expect(user).toBeDefined();
        testUserId = user._id;

        console.log('Test user created and logged in for task tests.');
    });

    // After all tests, clear data and close server/connection
    afterAll(async () => {
        await User.deleteMany({});
        await Task.deleteMany({});
        console.log('Cleaned up data after task tests.');

        // Robustly close the server only if it's a valid HTTP server instance
        if (server && typeof server.close === 'function') {
            await new Promise(resolve => server.close(resolve));
            console.log('Task test server closed.');
        } else {
            console.warn('Server instance not available or .close method not found for Task tests.');
        }

        // Disconnect Mongoose only if connected
        if (mongoose.connection.readyState === 1) {
            await mongoose.disconnect();
            console.log('Task test MongoDB disconnected.');
        } else {
            console.warn('Mongoose connection not active for Task tests.');
        }
    });

    // Variable to store task IDs for subsequent tests
    let taskIdToDelete;
    let taskToUpdateId;

    describe('POST /tasks (Create Task)', () => {
        test('should create a new task for the authenticated user', async () => {
            const res = await agent // Use the authenticated agent
                .post('/tasks')
                .send({
                    title: 'Buy Groceries',
                    description: 'Milk, Eggs, Bread'
                });
            expect(res.statusCode).toBe(302);
            expect(res.headers.location).toBe('/dashboard');

            // Verify task was created in DB for the user
            const task = await Task.findOne({ title: 'Buy Groceries', userId: testUserId });
            expect(task).toBeDefined();
            expect(task.title).toBe('Buy Groceries');
            expect(task.description).toBe('Milk, Eggs, Bread');
            expect(task.status).toBe('pending');
            taskIdToDelete = task._id; // Store for later deletion
            taskToUpdateId = task._id; // Store for later update
        });

        test('should not create a task without a title', async () => {
            const res = await agent // Use the authenticated agent
                .post('/tasks')
                .send({
                    description: 'This task has no title'
                });
            expect(res.statusCode).toBe(302);
            expect(res.headers.location).toBe('/dashboard');

            // Verify task was NOT created in DB
            const task = await Task.findOne({ description: 'This task has no title' });
            expect(task).toBeNull();
        });

        test('should not create a task if not authenticated', async () => {
            const res = await request(app) // Use raw request, not the authenticated agent
                .post('/tasks')
                .send({
                    title: 'Unauthorized Task',
                    description: 'Should fail'
                });
            expect(res.statusCode).toBe(302);
            expect(res.headers.location).toBe('/login'); // Should redirect to login page
        });
    });

    describe('GET /dashboard (View Tasks)', () => {
        // Add more tasks for the user and another user for isolation testing
        beforeAll(async () => {
            await Task.create({
                title: 'Another Pending Task',
                userId: testUserId,
                status: 'pending'
            });
            await Task.create({
                title: 'Completed Task',
                userId: testUserId,
                status: 'completed'
            });
            await Task.create({
                title: 'Deleted Task',
                userId: testUserId,
                status: 'deleted'
            });
            // Task for a different user (should not appear)
            const anotherUser = await User.create({ username: 'anotheruser', email: 'another@example.com', password: 'password123' });
            await Task.create({ title: 'Another User Task', userId: anotherUser._id, status: 'pending' });
        });

        test('should display all tasks for the authenticated user by default', async () => {
            const res = await agent.get('/dashboard');
            expect(res.statusCode).toBe(200);
            expect(res.headers['content-type']).toContain('text/html');
            expect(res.text).toContain('Buy Groceries');
            expect(res.text).toContain('Another Pending Task');
            expect(res.text).toContain('Completed Task');
            expect(res.text).toContain('Deleted Task');
            expect(res.text).not.toContain('Another User Task'); // Should not see other user's tasks
        });

        test('should filter tasks by status "pending"', async () => {
            const res = await agent.get('/dashboard?status=pending');
            expect(res.statusCode).toBe(200);
            expect(res.text).toContain('Buy Groceries');
            expect(res.text).toContain('Another Pending Task');
            expect(res.text).not.toContain('Completed Task');
            expect(res.text).not.toContain('Deleted Task');
        });

        test('should filter tasks by status "completed"', async () => {
            const res = await agent.get('/dashboard?status=completed');
            expect(res.statusCode).toBe(200);
            expect(res.text).toContain('Completed Task');
            expect(res.text).not.toContain('Buy Groceries');
            expect(res.text).not.toContain('Another Pending Task');
            expect(res.text).not.toContain('Deleted Task');
        });

        test('should not display dashboard if not authenticated', async () => {
            const res = await request(app).get('/dashboard'); // Use raw request
            expect(res.statusCode).toBe(302);
            expect(res.headers.location).toBe('/login');
        });
    });

    describe('POST /tasks/update-status/:id', () => {
        test('should update a task status to "completed"', async () => {
            const res = await agent
                .post(`/tasks/update-status/${taskToUpdateId}`)
                .send({ newStatus: 'completed' });
            expect(res.statusCode).toBe(302);
            expect(res.headers.location).toBe('/dashboard');

            const task = await Task.findById(taskToUpdateId);
            expect(task.status).toBe('completed');
        });

        test('should update a task status from "completed" to "deleted"', async () => {
            // Re-use the same task that was just set to completed
            const res = await agent
                .post(`/tasks/update-status/${taskToUpdateId}`)
                .send({ newStatus: 'deleted' });
            expect(res.statusCode).toBe(302);
            expect(res.headers.location).toBe('/dashboard');

            const task = await Task.findById(taskToUpdateId);
            expect(task.status).toBe('deleted');
        });

        test('should not update a task status if not authenticated', async () => {
            const res = await request(app) // Use raw request
                .post(`/tasks/update-status/${taskToUpdateId}`)
                .send({ newStatus: 'completed' });
            expect(res.statusCode).toBe(302);
            expect(res.headers.location).toBe('/login');
        });

        test('should not update a task that does not belong to the user', async () => {
            // Create a task for a different user
            const otherUser = await User.create({ username: 'otheruser', email: 'other@example.com', password: 'password123' });
            const otherTask = await Task.create({ title: 'Other User Task for Update', userId: otherUser._id, status: 'pending' });

            const res = await agent // Using authenticated agent (logged in as 'taskuser')
                .post(`/tasks/update-status/${otherTask._id}`)
                .send({ newStatus: 'completed' });
            expect(res.statusCode).toBe(302);
            expect(res.headers.location).toBe('/dashboard'); // Still redirects, but with error flash

            const task = await Task.findById(otherTask._id); // Verify status is unchanged
            expect(task.status).toBe('pending');
        });
    });

    describe('POST /tasks/delete/:id (Permanent Delete)', () => {
        let permDeleteTaskId;
        beforeAll(async () => {
            const task = await Task.create({
                title: 'Task for Permanent Delete',
                userId: testUserId,
                status: 'deleted' // Must be deleted to allow permanent delete from UI perspective
            });
            permDeleteTaskId = task._id;
        });

        test('should permanently delete a task belonging to the user', async () => {
            const res = await agent
                .post(`/tasks/delete/${permDeleteTaskId}`);
            expect(res.statusCode).toBe(302);
            expect(res.headers.location).toBe('/dashboard');

            // Verify task is deleted from DB
            const task = await Task.findById(permDeleteTaskId);
            expect(task).toBeNull();
        });

        test('should not permanently delete a task if not authenticated', async () => {
            const res = await request(app) // Use raw request
                .post(`/tasks/delete/${taskIdToDelete}`); // Using a task from initial creation
            expect(res.statusCode).toBe(302);
            expect(res.headers.location).toBe('/login');
        });

        test('should not permanently delete a task that does not belong to the user', async () => {
            // Create a new task for another user
            const otherUser = await User.create({ username: 'deleteotheruser', email: 'deleteother@example.com', password: 'password123' });
            const otherTask = await Task.create({ title: 'Another User Task for Delete', userId: otherUser._id, status: 'deleted' });

            const res = await agent // Using authenticated agent (logged in as 'taskuser')
                .post(`/tasks/delete/${otherTask._id}`);
            expect(res.statusCode).toBe(302);
            expect(res.headers.location).toBe('/dashboard');

            const task = await Task.findById(otherTask._id); // Verify task still exists
            expect(task).toBeDefined();
        });
    });

    describe('GET /logout', () => {
        test('should log out the user and redirect to login', async () => {
            const res = await agent.get('/logout');
            expect(res.statusCode).toBe(302);
            expect(res.headers.location).toBe('/login');
            // Supertest agent automatically handles session clearing; no explicit cookie check needed
        });
    });
});
