const express = require('express');
const mongoose = require('mongoose');
const ejs = require('ejs');
const path = require('path');
const passport = require('passport');
const session = require('express-session');
const bcrypt = require('bcrypt');
const {mongo} = require("mongoose");
const flash = require('connect-flash');
const bodyParser = require('body-parser');
const LocalStrategy = require('passport-local').Strategy;

const app = express();
const port = 3000;

mongoose.connect('mongodb://localhost:27017/wypozyczalnia-samochodow', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
});

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'Błąd połączenia z MongoDB:'));
db.once('open', () => {
    console.log('Połączono z MongoDB!');
});

app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: 'your-secret-key', resave: true, saveUninitialized: true }));
app.use(passport.initialize());
app.use(passport.session());
app.use(flash());
app.use(bodyParser.urlencoded({ extended: true }));


const carSchema = new mongoose.Schema({
    manufacturer: String,
    model: String,
    rental_value: String,
    car_classification: String,
    transmission_type: String,
    fuel_type: String,
    drivetrain_type: String,
    engine_power: String,
    door_number: String,
    seat_number: String
});

const customerSchema = new mongoose.Schema({
    login: String,
    email: String,
    password: String,
    first_name: String,
    last_name: String,
    city: String,
    street: String,
    building_number: String,
    phone_number: String,
    date_of_birth: Date,
    rentals: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Rental' }], // Dodane pole rentals
});

const rentalsSchema = new mongoose.Schema({
    start_date: Date,
    end_date: Date,
    customer_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
    car_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Car' },
    is_archived: Boolean
});

const Car = mongoose.model('Car', carSchema);
const Customer = mongoose.model('Customer', customerSchema);
const Rental = mongoose.model('Rental', rentalsSchema);

// Konfiguracja Passport
passport.use(new LocalStrategy({ usernameField: 'login' }, async (login, password, done) => {
    try {
        const customer = await Customer.findOne({ login: login }).exec();

        if (!customer) {
            return done(null, false, { message: 'Incorrect username.' });
        }

        if (!bcrypt.compareSync(password, customer.password)) {
            return done(null, false, { message: 'Incorrect password.' });
        }

        return done(null, customer);
    } catch (err) {
        return done(err);
    }
}));

passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    try {
        const user = await Customer.findById(id).exec();
        done(null, user);
    } catch (err) {
        done(err, null);
    }
});


app.set('view engine', 'ejs');

app.use('/static', express.static(path.join(__dirname, 'static')));
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js')));

const ensureAuthenticated = (req, res, next) => {
    if (req.isAuthenticated()) {
        return next();
    }
    res.redirect('/login');
};
app.get('/', async (req, res) => {
    try {
        res.render('index');
    } catch (error) {
        res.status(500).send('Wystąpił błąd.');
    }
});

app.get('/login', (req, res) => {
    res.render('login');
});

app.post('/login', passport.authenticate('local', {
    successRedirect: '/rentals',
    failureRedirect: '/login',
    failureFlash: true
}));

app.get('/registration', (req, res) => {
    res.render('registration');
});

app.post('/registration', async (req, res) => {
    try {
        if (!req.body.password) {
            throw new Error('Brak hasła w żądaniu rejestracyjnym.');
        }

        const hashedPassword = bcrypt.hashSync(req.body.password, 10);

        const newUser = new Customer({
            login: req.body.login,
            email: req.body.email,
            password: hashedPassword,
            first_name: req.body.first_name,
            last_name: req.body.last_name,
            city: req.body.city,
            street: req.body.street,
            building_number: req.body.building_number,
            phone_number: req.body.phone_number,
            date_of_birth: req.body.date_of_birth
        });

        await newUser.save();

        req.flash('success', 'Rejestracja udana. Możesz się teraz zalogować.');
        res.redirect('/login');
    } catch (error) {
        console.error(error);
        req.flash('error', 'Wystąpił błąd podczas rejestracji.');
        res.redirect('/registration');
    }
});



app.get('/cars', async (req, res) => {
    try {
        const cars = await Car.find();
        res.render('cars', { cars });
    } catch (error) {
        res.status(500).send('Wystąpił błąd podczas pobierania samochodów.');
    }
});

app.get('/new-rental', ensureAuthenticated, async (req, res) => {
    try {
        const cars = await Car.find();
        res.render('new-rental', { cars });
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal Server Error');
    }
});

app.post('/new-rental', ensureAuthenticated, async (req, res) => {
    try {
        const carId = req.body.carId;
        const startDate = req.body.startDate;
        const endDate = req.body.endDate;
        const userId = req.user._id;

        const newRental = new Rental({
            start_date: startDate,
            end_date: endDate,
            car_id: carId,
            customer_id: userId,
            is_archived: false
        });

        await newRental.save();

        await Car.findByIdAndUpdate(carId, { is_available: false });

        res.redirect('/rentals');
    } catch (error) {
        console.error(error);
        res.status(500).send('Wystąpił błąd wewnętrzny serwera');
    }
});

app.get('/rentals', ensureAuthenticated, (req, res) => {
    Rental.find({ customer_id: req.user._id })
        .populate('car_id')
        .then(rentals => {
            res.render('rentals', { rentals });
        })
        .catch(err => {
            console.error(err);
            res.status(500).send('Internal Server Error');
        });
});


app.get('/cars/details/:carId', async (req, res) => {
    try {
        const carId = req.params.carId;
        const car = await Car.findById(carId);

        if (!car) {
            return res.status(404).send('Nie znaleziono samochodu o podanym identyfikatorze.');
        }

        res.render('details', { car });
    } catch (error) {
        res.status(500).send('Wystąpił błąd podczas pobierania szczegółów samochodu.');
    }
});

app.listen(port, () => {
    console.log(`Serwer uruchomiony na http://localhost:${port}`);
});
