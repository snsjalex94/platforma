const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const bodyParser = require('body-parser');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let professorData = [];
let isTimerActive = false;
let remainingTime = 300000; // 5 minutes in milliseconds
let timerInterval;

// File path to store submitted answers
const filePath = 'submittedAnswers.json';

function readProfessorDataFromFile() {
    try {
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        professorData = JSON.parse(fileContent);
    } catch (err) {
        console.error('Error reading file:', err);
    }
}

readProfessorDataFromFile();

app.use(bodyParser.json());

app.get('/', (req, res) => {
    res.sendFile('index.html', { root: __dirname });
});

app.get('/professor', (req, res) => {
    // Read professorData from file when the professor page is requested
    readProfessorDataFromFile();
    res.sendFile('professor.html', { root: __dirname });
});

app.get('/kids', (req, res) => {
    res.sendFile('kids.html', { root: __dirname });
});

wss.on('connection', ws => {
    console.log('WebSocket connection established');
    // Inside the 'wss.on('connection', ws => {...}' block
wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'timerStatus', status: isTimerActive ? 'Live' : 'Not Live', remainingTime }));
    }
});


    // Send initial data to the connected client
    ws.send(JSON.stringify(professorData));

    ws.on('message', message => {
        const parsedMessage = JSON.parse(message);

        if (parsedMessage.type === 'approve') {
            const index = parsedMessage.id;

            professorData[index].status = 'Approved';

            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'update', data: professorData }));
                }
            });

            console.log('Updated Data:', professorData);
        } else if (parsedMessage.type === 'update') {
            ws.send(JSON.stringify({ type: 'update', data: professorData }));
        } else if (parsedMessage.type === 'start') {
            isTimerActive = true;

            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'timerStatus', status: 'Live', remainingTime }));
                }
            });

            timerInterval = setInterval(() => {
                remainingTime -= 1000;
                if (remainingTime <= 0) {
                    clearInterval(timerInterval);
                    isTimerActive = false;

                    wss.clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({ type: 'timerStatus', status: 'Not Live', remainingTime: 0 }));
                        }
                    });
                }
            }, 1000);
        } else if (parsedMessage.type === 'clearData') {
            clearInterval(timerInterval);
            isTimerActive = false;
            remainingTime = 300000;
            professorData = [];

            // Clear data in file
            fs.writeFileSync(filePath, '[]', 'utf-8');

            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'update', data: professorData }));
                }
            });
        } else if (parsedMessage.type === 'submitAnswer') {
            const kidIndex = professorData.length + 1;
            const submittedAnswer = Array.isArray(parsedMessage.answer)
                ? parsedMessage.answer
                : [parsedMessage.answer];

            // Transform submittedAnswer into an array of objects
            const submittedAnswerObjects = submittedAnswer.map(answer => ({
                kid: `Kid ${kidIndex}`,
                answer: answer,
                status: 'Pending',
            }));

            // Add submitted answers to the global array
            professorData.push(...submittedAnswerObjects);

            // Broadcast the submitted answer to all connected clients (including professor)
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    const data = {
                        type: 'submittedAnswer',
                        data: submittedAnswerObjects,
                    };
                    client.send(JSON.stringify(data));
                }
            });

            // Save professorData to the file after updating
            fs.writeFileSync(filePath, JSON.stringify(professorData), 'utf-8');
        }
    });

    setInterval(() => {
        const timerStatus = {
            type: 'timerStatus',
            status: isTimerActive ? 'Live' : 'Not Live',
            remainingTime: isTimerActive ? remainingTime : 0,
        };

        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(timerStatus));
            }
        });
    }, 1000);
});

// Handle POST request for submitting answers
app.post('/api/kids/submit-answer', (req, res) => {
    // Uncomment the lines below if you want to send an error response to the kids when the session is not live.
    // Note: This will prevent further execution of the function, so the submitted answers won't be processed.
    // res.json({ success: false, message: 'Session is not live. You cannot submit answers.' });

    const kidIndex = professorData.length + 1;
    const submittedAnswer = Array.isArray(req.body.answer) ? req.body.answer : [req.body.answer];

    // Transform submittedAnswer into an array of objects
    const submittedAnswerObjects = submittedAnswer.map(answer => ({
        kid: `Kid ${kidIndex}`,
        answer: answer,
        status: 'Pending',
    }));

    // Check if the session is live
    if (!isTimerActive) {
        // Send an error response to the kids when the session is not live
        return res.json({ success: false, message: 'Session is not live. You cannot submit answers.' });
    }

    // Add submitted answers to the global array
    professorData.push(...submittedAnswerObjects);

    // Broadcast the submitted answer to all connected clients (including professor)
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            const data = {
                type: 'submittedAnswer',
                data: submittedAnswerObjects,
            };
            client.send(JSON.stringify(data));
        }
    });

    // Save professorData to the file after updating
    fs.writeFileSync(filePath, JSON.stringify(professorData), 'utf-8');

    // Send a response to the client
    res.json({ success: true, message: 'Answer submitted successfully' });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
