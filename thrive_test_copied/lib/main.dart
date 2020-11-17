import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:thrive_test/Screens/login_screen.dart';
import 'package:thrive_test/Screens/login_screen0.dart';
import 'package:thrive_test/Screens/profile_screen.dart';
import 'package:thrive_test/Screens/registration_screen.dart';
import 'package:thrive_test/Screens/welcome_screen.dart';
import 'package:thrive_test/Screens/welcome_screen2.dart';


void main() async {
  runApp(Thrive());
  await Firebase.initializeApp();
}


class Thrive extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      theme: ThemeData.dark().copyWith(
        textTheme: TextTheme(
          body1: TextStyle(color: Colors.black54),
        ),
      ),
      initialRoute: LoginScreen0.id ,
      routes: {
        WelcomeScreen.id:(context)=>WelcomeScreen(),
        WelcomeScreen2.id:(context)=>WelcomeScreen2(),
        LoginScreen.id:(context)=>LoginScreen(),
        RegistrationScreen.id:(context)=>RegistrationScreen(),
        ProfileScreen.id:(context)=>ProfileScreen(),
        LoginScreen0.id:(context)=>LoginScreen0(),

      },
    );
  }
}