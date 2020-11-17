import 'dart:ui';

import 'package:flutter/material.dart';

class TextFieldCompo extends StatelessWidget {
  TextFieldCompo({this.hint, this.color, this. onChanged, InputDecoration decoration});

  final Color color;
  final String hint;
  final Function onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 20,
      width: 5,
      child:TextField(
        selectionHeightStyle: BoxHeightStyle.tight,
        textAlign: TextAlign.center,
        onChanged: onChanged,
        decoration: InputDecoration(
          hintText: hint,
          hintStyle: TextStyle(fontSize: 20.0, color: Colors.black12),
          contentPadding:
          EdgeInsets.symmetric(vertical: 10.0, horizontal: 20.0),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.all(Radius.circular(32.0)),),
          enabledBorder: OutlineInputBorder(
            borderSide:
            BorderSide(color: Colors.lightBlueAccent, width: 1.0),
            borderRadius: BorderRadius.all(Radius.circular(32.0)),
          ),
          focusedBorder: OutlineInputBorder(
            borderSide:
            BorderSide(color: Colors.lightBlueAccent, width: 2.0),
            borderRadius: BorderRadius.all(Radius.circular(32.0)),
          ),
        ),
      )

    );

  }
}