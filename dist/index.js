"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hello = void 0;
const hello = (req, res) => {
    console.log('Hello World function triggered');
    res.status(200).send({
        message: 'Hello World from Serverless TypeScript!',
        input: req.body,
    });
};
exports.hello = hello;
