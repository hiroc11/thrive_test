import 'package:flutter/material.dart';

class RoundedButton extends StatelessWidget{
  RoundedButton({this.title, this.color, @required this.onPressed});

  final Color color;
  final String title;
  final Function onPressed;

@override
Widget build (BuildContext context) {
  return
    Container(
      decoration: BoxDecoration(
        border: Border.all(color: Colors.lightBlueAccent),
        borderRadius: BorderRadius.circular(30.0),
      ),
      child: Material(
        borderRadius: BorderRadius.all(Radius.circular(30.0)),
        color: color,
        child: MaterialButton(
          onPressed:onPressed,
          minWidth: 200.0,
          height: 42.0,
          child: Text(
            title,
          ),
        ),
      ),
    );
}
}