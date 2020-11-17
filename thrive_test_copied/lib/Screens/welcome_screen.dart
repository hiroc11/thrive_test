import 'package:flutter/material.dart';
import 'package:thrive_test/Components/RoundedButton.dart';
import 'package:thrive_test/Screens/welcome_screen2.dart';

class WelcomeScreen extends StatefulWidget {
  static const String id ='welcome_screen';
  @override
  _WelcomeScreenState createState() => _WelcomeScreenState();
}

class _WelcomeScreenState extends State<WelcomeScreen> {
  @override
  Widget build(BuildContext context) {
    final double deviceHeight=MediaQuery.of(context).size.height;
    return Scaffold(
      backgroundColor: Colors.white,
      body:Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisAlignment: MainAxisAlignment.end,
          children: <Widget>[
            Container(
              child: Column(
                children:<Widget> [
                  Container(
                    child: Text('Hello'),
                  ),
                  Row(
                    children: <Widget>[
                      Text('Welcome To'),
                      Text('Thrive'),
                    ],
                  ),
                ],
              ),
            ),
            Stack(
              children: <Widget>[
                Container(
                    child: Image.asset('images/coffee2.jpg',fit: BoxFit.fill,)
                ),
                RoundedButton(
                  title: 'Get Started',
                  color: Colors.lightBlue,
                  onPressed: (){
                    Navigator.pushNamed(context, WelcomeScreen2.id);
                  },
                ),
              ],
            ),],
    ),
    );
  }
}
