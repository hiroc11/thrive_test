import 'package:flutter/material.dart';
import 'package:thrive_test/Components/RoundedButton.dart';
import 'package:thrive_test/Screens/login_screen.dart';
import 'package:thrive_test/Screens/registration_screen.dart';

class WelcomeScreen2 extends StatefulWidget {
  static const String id ='welcome_screen2';
  @override
 _WelcomeScreenState2 createState()=>_WelcomeScreenState2();
}

class _WelcomeScreenState2 extends State<WelcomeScreen2> {
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
                child: Image.asset('images/coffee2.jpg',fit: BoxFit.fill,)
              ),
              RoundedButton(
                title: 'Continue with Facebook',
                color: Colors.purple,
                onPressed: (){
                  Navigator.pushNamed(context, RegistrationScreen.id);
                },
              ),
              RoundedButton(
                title: 'Continue with Twitter',
                color: Colors.lightBlue,
                onPressed: (){
                  Navigator.pushNamed(context, RegistrationScreen.id);
                },
              ),
              RoundedButton(
                title: 'Continue with Google',
                color: Colors.redAccent,
                onPressed: (){
                  Navigator.pushNamed(context, RegistrationScreen.id);
                },
              ),
              RoundedButton(
                title: 'Continue with Google',
                color: Colors.black,
                onPressed: (){
                  Navigator.pushNamed(context, RegistrationScreen.id);
                },
              ),
          ],
      ),
    );
  }
}
