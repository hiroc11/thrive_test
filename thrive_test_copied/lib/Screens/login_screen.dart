import 'package:flutter/material.dart';
import 'package:thrive_test/Components/TextFieldCompo.dart';
import 'package:thrive_test/Components/RoundedButton.dart';
import 'package:thrive_test/Screens/profile_screen.dart';
import 'package:firebase_auth/firebase_auth.dart';

class LoginScreen extends StatefulWidget {
  static const String id ='login_screen';
  @override
  _LoginScreenState createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: Padding(
        padding: EdgeInsets.symmetric(horizontal: 24.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Container(
              height: 200.0,
              child: Image.asset('images/logo.png'),
            ),
            SizedBox(
              height: 48.0,
            ),
            TextFieldCompo(
              hint: 'enter your Email',
              color:Colors.blueAccent
            ),
            SizedBox(
              height: 8.0,
            ),
            TextFieldCompo(
                hint:'enter your password',
                color: Colors.blueAccent,
            ),
            SizedBox(
              height: 24.0,
            ),
            RoundedButton(
              title: 'Login',
              color: Colors.lightBlue,
              onPressed: (){
                Navigator.pushNamed(context, ProfileScreen.id);
              },
            )
          ],
        ),
      ),
    );
  }
}
